package dev.nakama.companion

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import java.util.PriorityQueue
import java.util.Locale
import java.util.UUID

object LocalChatPolicy {
    const val WINDOW_MS = 6 * 60 * 60 * 1000L
    const val SEGMENT_ENTRIES = 32
    const val PART_CHARS = 8000
    const val SCAN_FILES = 20
    const val MAX_FILE_BYTES = 1_700_000L
    fun expired(startedAt: String, now: Instant): Boolean = runCatching { now.toEpochMilli() - Instant.parse(startedAt).toEpochMilli() >= WINDOW_MS }.getOrDefault(true)
    fun parts(content: String): List<String> {
        if (content.isEmpty()) return listOf("")
        val result = mutableListOf<String>(); var offset = 0
        while (offset < content.length) {
            var end = minOf(content.length, offset + PART_CHARS)
            if (end < content.length && content[end - 1].isHighSurrogate() && content[end].isLowSurrogate()) end--
            result += content.substring(offset, end); offset = end
        }
        return result
    }
    fun extract(messages: List<Pair<String, String>>): String {
        fun clean(text: String) = text.replace(Regex("[\\x00-\\x1f\\x7f]"), " ").replace(Regex("\\s+"), " ").trim().take(240)
        if (messages.isEmpty()) return ""
        val turns = mutableListOf<MutableList<Pair<String, String>>>()
        messages.forEach { message ->
            if (message.first == "user" || turns.isEmpty()) turns += mutableListOf<Pair<String, String>>()
            turns.last().add(message)
        }
        val decision = Regex("\\b(important|decided|decision|agreed|requirement|deadline|must|completed|created|saved|blocked|failed|next step|follow.up)\\b", RegexOption.IGNORE_CASE)
        val sections = minOf(6, turns.size)
        val selected = (0 until sections).map { section ->
            val candidates = turns.subList(section * turns.size / sections, (section + 1) * turns.size / sections)
            candidates.maxBy { turn -> if (turn.any { decision.containsMatchIn(it.second.take(1800)) }) 1 else 0 }
        }
        return selected.joinToString(" | ") { turn ->
            val pair = if (turn.size > 1) listOf(turn.first(), turn.last()) else turn
            pair.joinToString(" → ") { (role, text) -> "${if (role == "user") "You" else "Nakama"}: ${clean(text).take(100)}" }
        }.take(1400)
    }
}

data class LocalChatArchive(val id: String, val startedAt: String, val updatedAt: String, val count: Int, val summary: String)
data class LocalChatPage(val chats: List<LocalChatArchive>, val nextCursor: String?)

/** Retains originals until explicit deletion. Each immutable segment and each read page is bounded. */
class LocalChatHistory(private val directory: File, private val clock: () -> Instant = { Instant.now() }) {
    companion object {
        private val ioLock = Any()
        fun scope(identity: HostIdentity?): String {
            val value = identity?.let { "${it.fingerprint}:${it.deviceId}" } ?: "local-only"
            return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(Locale.ROOT, it) }
        }
    }
    fun rotate(scope: String): Boolean = synchronized(ioLock) { rotateLocked(scope) }
    fun current(scope: String): List<JSONObject> = synchronized(ioLock) { currentLocked(scope) }
    fun append(scope: String, message: JSONObject) = synchronized(ioLock) { appendLocked(scope, message) }
    fun transcript(scope: String, id: String): List<JSONObject> = synchronized(ioLock) { transcriptLocked(scope, id) }
    fun page(scope: String, query: String = "", cursor: String? = null): LocalChatPage = synchronized(ioLock) { pageLocked(scope, query, cursor) }
    fun clear(scope: String) = synchronized(ioLock) { clearLocked(scope) }
    private fun folder(scope: String): File {
        require(scope.matches(Regex("[a-f0-9]{64}"))) { "Invalid local chat scope." }
        return File(directory, scope).also { check(it.canonicalFile.parentFile == directory.canonicalFile); it.mkdirs() }
    }
    private fun read(file: File): JSONObject {
        val bytes = AtomicFile(file).openRead().use { input ->
            val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (output.size() <= LocalChatPolicy.MAX_FILE_BYTES) {
                val size = input.read(buffer, 0, minOf(buffer.size, LocalChatPolicy.MAX_FILE_BYTES.toInt() + 1 - output.size()))
                if (size < 0) break
                output.write(buffer, 0, size)
            }
            output.toByteArray()
        }
        check(bytes.size <= LocalChatPolicy.MAX_FILE_BYTES) { "A local chat file needs recovery; it has been retained." }
        return JSONObject(String(bytes, Charsets.UTF_8))
    }
    private fun save(file: File, value: JSONObject) {
        val bytes = value.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size <= LocalChatPolicy.MAX_FILE_BYTES) { "This local chat segment is too large; its existing original has been retained." }
        val atomic = AtomicFile(file); val stream = atomic.startWrite()
        try { stream.write(bytes); atomic.finishWrite(stream) } catch (failure: Exception) { atomic.failWrite(stream); throw failure }
    }
    private fun active(root: File): JSONObject? {
        val file = File(root, "active.json")
        if (!file.exists() && !File(root, "active.json.bak").exists()) return null
        val value = read(file)
        // Recover a crash after archive commit but before clearing the active pointer.
        if (File(File(root, "archive"), "${checkedId(value.getString("id"))}.json").exists()) { AtomicFile(file).delete(); return null }
        return value
    }
    private fun fresh(at: Instant) = JSONObject().put("id", "%013d-%s".format(Locale.ROOT, at.toEpochMilli().coerceAtLeast(0), UUID.randomUUID())).put("startedAt", at.toString()).put("updatedAt", at.toString()).put("messages", JSONArray())
    private fun archive(root: File, value: JSONObject) {
        val entries = value.objects("messages")
        if (entries.isEmpty()) return
        value.put("summary", LocalChatPolicy.extract(entries.map { it.optString("role") to it.optString("content") }))
        val archives = File(root, "archive").also { it.mkdirs() }
        save(File(archives, "${checkedId(value.getString("id"))}.json"), value)
        AtomicFile(File(root, "active.json")).delete()
    }
    private fun rotateLocked(scope: String): Boolean {
        val root = folder(scope); val value = active(root) ?: return false
        if (!LocalChatPolicy.expired(value.getString("startedAt"), clock())) return false
        archive(root, value); return true
    }
    private fun currentLocked(scope: String): List<JSONObject> {
        rotate(scope)
        return active(folder(scope))?.objects("messages").orEmpty()
    }
    private fun appendLocked(scope: String, message: JSONObject) {
        require(message.getString("id").length <= 200) { "Invalid local message ID." }
        require(message.getString("role") in listOf("user", "assistant")) { "Invalid local message role." }
        Instant.parse(message.getString("createdAt"))
        val root = folder(scope); val at = clock()
        var value = active(root)
        if (value != null && LocalChatPolicy.expired(value.getString("startedAt"), at)) { archive(root, value); value = null }
        val parts = LocalChatPolicy.parts(message.getString("content"))
        for ((index, content) in parts.withIndex()) {
            if (value == null) value = fresh(at)
            if (value.getJSONArray("messages").length() >= LocalChatPolicy.SEGMENT_ENTRIES) { archive(root, value); value = fresh(at) }
            val entry = JSONObject().put("id", message.getString("id")).put("role", message.getString("role")).put("createdAt", message.getString("createdAt")).put("content", content)
            if (parts.size > 1) entry.put("originalMessageId", message.getString("id")).put("id", "${message.getString("id")}-part-${index + 1}").put("part", index + 1).put("parts", parts.size)
            value.getJSONArray("messages").put(entry)
            value.put("updatedAt", message.getString("createdAt"))
        }
        value?.let { save(File(root, "active.json"), it) }
    }
    private fun checkedId(id: String): String { require(id.matches(Regex("[0-9]{13}-[a-f0-9-]{36}"))) { "Invalid local archive." }; return id }
    private fun transcriptLocked(scope: String, id: String): List<JSONObject> = read(File(File(folder(scope), "archive"), "${checkedId(id)}.json")).objects("messages")
    private fun pageLocked(scope: String, query: String = "", cursor: String? = null): LocalChatPage {
        require(query.length <= 200) { "Search with up to 200 characters." }; cursor?.let(::checkedId)
        rotate(scope)
        val archives = File(folder(scope), "archive")
        if (!archives.exists()) return LocalChatPage(emptyList(), null)
        // Keep at most one page of filenames in memory while walking an arbitrarily long archive.
        val selected = PriorityQueue<String>()
        Files.newDirectoryStream(archives.toPath(), "*.json").use { entries -> for (entry in entries) {
            val id = entry.fileName.toString().removeSuffix(".json")
            if (!id.matches(Regex("[0-9]{13}-[a-f0-9-]{36}")) || (cursor != null && id >= cursor)) continue
            selected.add(id); if (selected.size > LocalChatPolicy.SCAN_FILES + 1) selected.poll()
        } }
        val newest = selected.toList().sortedDescending(); val slice = newest.take(LocalChatPolicy.SCAN_FILES)
        val rows = mutableListOf<LocalChatArchive>()
        for (id in slice) {
            val value = read(File(archives, "$id.json"))
            if (query.isBlank() || value.optString("summary").contains(query, ignoreCase = true) || value.objects("messages").any { it.optString("content").contains(query, ignoreCase = true) }) {
                rows += LocalChatArchive(checkedId(value.getString("id")), value.getString("startedAt"), value.getString("updatedAt"), value.getJSONArray("messages").length(), value.optString("summary"))
            }
        }
        return LocalChatPage(rows, if (newest.size > LocalChatPolicy.SCAN_FILES) slice.last() else null)
    }
    private fun clearLocked(scope: String) {
        val root = folder(scope)
        check(root.canonicalFile.parentFile == directory.canonicalFile)
        check(root.deleteRecursively()) { "Some local history could not be cleared." }
    }
}
