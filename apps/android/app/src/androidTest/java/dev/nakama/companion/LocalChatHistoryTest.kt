package dev.nakama.companion

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LocalChatHistoryTest {
    private fun directory(): File {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "local-history-fixture-${UUID.randomUUID()}").apply { mkdirs() }
    }
    private fun message(id: String, content: String, role: String = "user") = JSONObject().put("id", id).put("content", content).put("role", role).put("createdAt", "2026-10-03T08:00:00Z")
    private val scope = LocalChatHistory.scope(null)
    @Test fun sixHourRotationRetainsOriginalAcrossRestartAndClearIsScoped() {
        val directory = directory()
        try {
            var now = Instant.parse("2026-10-03T08:00:00Z")
            val history = LocalChatHistory(directory) { now }
            val original = "  Original whitespace\nremains unchanged 🌍  "
            history.append(scope, message("original", original))
            now = now.plusMillis(LocalChatPolicy.WINDOW_MS - 1)
            assertEquals(original, history.current(scope).single().getString("content"))
            now = now.plusMillis(1)
            assertTrue(history.current(scope).isEmpty())
            val restored = LocalChatHistory(directory) { now }
            val archive = restored.page(scope).chats.single()
            assertEquals(original, restored.transcript(scope, archive.id).single().getString("content"))
            val other = "a".repeat(64)
            restored.append(other, message("other", "Another pairing"))
            restored.clear(scope)
            assertTrue(restored.page(scope).chats.isEmpty())
            assertEquals("Another pairing", restored.current(other).single().getString("content"))
        } finally { directory.deleteRecursively() }
    }
    @Test fun archivesAreRetainedBeyondOneBoundedPageAndSearchIncludesRawMiddle() {
        val directory = directory()
        try {
            var now = Instant.parse("2026-10-03T08:00:00Z")
            val history = LocalChatHistory(directory) { now }
            repeat(23) { index ->
                history.append(scope, message("m$index", "Original segment $index"))
                now = now.plusMillis(LocalChatPolicy.WINDOW_MS)
                history.rotate(scope)
            }
            val first = history.page(scope)
            assertEquals(20, first.chats.size)
            val second = history.page(scope, cursor = first.nextCursor)
            assertEquals(3, second.chats.size)
            assertNull(second.nextCursor)
            assertEquals(23, File(File(directory, scope), "archive").listFiles()!!.size)
            repeat(24) { index -> history.append(scope, message("raw$index", if (index == 2) "needle-in-original-middle" else "Routine $index")) }
            now = now.plusMillis(LocalChatPolicy.WINDOW_MS); history.rotate(scope)
            val found = history.page(scope, "needle-in-original-middle").chats.single()
            assertFalse(found.summary.contains("needle-in-original-middle"))
            assertTrue(history.transcript(scope, found.id).any { it.getString("content") == "needle-in-original-middle" })
            assertTrue(runCatching { history.page(scope, cursor = "../../escape") }.isFailure)
            assertTrue(runCatching { history.current("../escape") }.isFailure)
        } finally { directory.deleteRecursively() }
    }
    @Test fun longOriginalRemainsLosslessAcrossBoundedSegmentFiles() {
        val directory = directory()
        try {
            var now = Instant.parse("2026-10-03T08:00:00Z")
            val history = LocalChatHistory(directory) { now }
            val content = "🌍\u0001".repeat(100_000)
            history.append(scope, message("large", content))
            now = now.plusMillis(LocalChatPolicy.WINDOW_MS); history.rotate(scope)
            val pieces = history.page(scope).chats.flatMap { history.transcript(scope, it.id) }.sortedBy { it.getInt("part") }
            assertEquals(content, pieces.joinToString("") { it.getString("content") })
            assertTrue(File(File(directory, scope), "archive").listFiles()!!.all { it.length() <= LocalChatPolicy.MAX_FILE_BYTES })
        } finally { directory.deleteRecursively() }
    }
    @Test fun separateForegroundAndWakeInstancesDoNotOverwriteEachOther() {
        val directory = directory(); val executor = Executors.newFixedThreadPool(2)
        try {
            val instant = Instant.parse("2026-10-03T08:00:00Z")
            val one = LocalChatHistory(directory) { instant }; val two = LocalChatHistory(directory) { instant }
            val tasks = (0 until 30).map { index -> executor.submit { (if (index % 2 == 0) one else two).append(scope, message("m$index", "Concurrent original $index")) } }
            tasks.forEach { it.get(10, TimeUnit.SECONDS) }
            assertEquals((0 until 30).map { "m$it" }.toSet(), one.current(scope).map { it.getString("id") }.toSet())
        } finally { executor.shutdownNow(); directory.deleteRecursively() }
    }
}
