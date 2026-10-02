package dev.nakama.companion

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID

internal data class BundledModelFile(val path: String, val bytes: Long, val sha256: String)
internal data class BundledModelManifest(val id: String, val files: List<BundledModelFile>)
internal object BundledModelPolicy {
    const val MAX_TOTAL_BYTES = 512L * 1024 * 1024
    fun validate(manifest: BundledModelManifest) {
        require(manifest.id.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,99}")) && manifest.id !in setOf(".", "..")) { "Invalid bundled model identity." }
        require(manifest.files.size in 1..1024) { "Invalid bundled model manifest size." }
        require(manifest.files.map { it.path }.distinct().size == manifest.files.size) { "Duplicate bundled model path." }
        var total = 0L
        manifest.files.forEach {
            require(it.path.length in 1..240 && it.path.split('/').all { segment -> segment.isNotBlank() && segment !in setOf(".", "..") && segment.matches(Regex("[A-Za-z0-9._-]+")) }) { "Invalid bundled model path." }
            require(it.bytes in 0..(256L * 1024 * 1024) && it.sha256.matches(Regex("[a-f0-9]{64}"))) { "Invalid bundled model checksum." }
            total += it.bytes
            require(total <= MAX_TOTAL_BYTES) { "Bundled model exceeds its size limit." }
        }
    }
}

/** APK assets only; no downloads, external model paths, microphone files, or OS speech models. */
internal object BundledSpeechModel {
    private const val ASSET_ROOT = "speech-model"
    private val manifestLock = Any()
    private val preparationLock = Any()
    @Volatile private var cachedManifest: BundledModelManifest? = null
    @Volatile private var prepared: File? = null
    /** Run on a worker. Capability checks never wait on this potentially slow extraction lock. */
    fun prepare(context: Context): File = synchronized(preparationLock) {
        prepared?.let { return it }
        val spec = manifest(context)
        val root = File(context.applicationContext.filesDir, "bundled-speech").canonicalFile
        check(root.isDirectory || root.mkdirs()) { "Could not create bundled speech storage." }
        val target = child(root, spec.id)
        if (!verify(target, spec)) {
            root.listFiles()?.filter { it.name.startsWith(".stage-") }?.forEach { remove(root, it) }
            val stage = child(root, ".stage-" + UUID.randomUUID())
            check(stage.mkdirs()) { "Could not prepare the bundled speech model." }
            try {
                spec.files.forEach { entry ->
                    val output = child(stage, entry.path)
                    check(output.parentFile?.isDirectory == true || output.parentFile?.mkdirs() == true) { "Could not prepare a bundled model folder." }
                    val digest = MessageDigest.getInstance("SHA-256")
                    var count = 0L
                    context.assets.open("$ASSET_ROOT/model/${entry.path}").use { input ->
                        output.outputStream().use { sink ->
                            val buffer = ByteArray(16_384)
                            while (true) {
                                val size = input.read(buffer)
                                if (size < 0) break
                                count += size
                                check(count <= entry.bytes) { "Bundled model file length did not match." }
                                digest.update(buffer, 0, size); sink.write(buffer, 0, size)
                            }
                            sink.fd.sync()
                        }
                    }
                    check(count == entry.bytes && hex(digest.digest()) == entry.sha256) { "Bundled model verification failed." }
                }
                if (target.exists()) remove(root, target)
                check(stage.renameTo(target)) { "Could not finish bundled model preparation." }
            } finally { if (stage.exists()) remove(root, stage) }
        }
        // Only our old verified-model directories; a successful replacement is already present.
        root.listFiles()?.filter { it != target && it.isDirectory &&
            (it.name.startsWith("sherpa-onnx-") || it.name.startsWith("nakama-speech-")) }
            ?.forEach { obsolete -> runCatching { remove(root, obsolete) } }
        target.also { prepared = it }
    }
    fun available(context: Context): Boolean = runCatching { manifest(context); true }.getOrDefault(false)
    fun manifest(context: Context): BundledModelManifest = synchronized(manifestLock) {
        cachedManifest?.let { return it }
        val bytes = context.assets.open("$ASSET_ROOT/manifest.json").use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8_192)
            while (true) {
                val count = input.read(buffer); if (count < 0) break
                check(output.size() + count <= 256 * 1024) { "Bundled model manifest is too large." }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
        val json = JSONObject(bytes.toString(Charsets.UTF_8))
        val values = json.getJSONArray("files")
        val parsed = BundledModelManifest(json.getString("id"), (0 until values.length()).map { index ->
            val entry = values.getJSONObject(index)
            BundledModelFile(entry.getString("path"), entry.getLong("bytes"), entry.getString("sha256"))
        })
        BundledModelPolicy.validate(parsed)
        parsed.also { cachedManifest = it }
    }
    private fun child(root: File, path: String): File = File(root, path).canonicalFile.also {
        check(it.path.startsWith(root.canonicalPath + File.separator)) { "Bundled model path escaped storage." }
    }
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun verify(directory: File, spec: BundledModelManifest): Boolean = runCatching {
        directory.isDirectory && spec.files.all { entry ->
            val file = child(directory, entry.path)
            if (!file.isFile || file.length() != entry.bytes) false else {
                val digest = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer = ByteArray(16_384)
                    while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
                }
                hex(digest.digest()) == entry.sha256
            }
        }
    }.getOrDefault(false)
    private fun remove(root: File, file: File) {
        check(file.canonicalPath.startsWith(root.canonicalPath + File.separator)) { "Bundled cleanup path escaped storage." }
        file.walkBottomUp().forEach {
            check(it.canonicalPath.startsWith(root.canonicalPath + File.separator)) { "Bundled cleanup path escaped storage." }
            check(it.delete() || !it.exists()) { "Could not remove an incomplete bundled model file." }
        }
    }
}
