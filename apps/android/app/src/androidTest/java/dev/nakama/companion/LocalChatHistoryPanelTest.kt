package dev.nakama.companion

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LocalChatHistoryPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && result.size < 1000) { val node = queue.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 12_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun click(text: String) {
        await("Missing control $text") {
            var node = nodes().firstOrNull { it.text?.toString() == text && it.isVisibleToUser }
            repeat(8) {
                if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node = node?.parent
            }; false
        }
    }
    private fun visible(text: String) = nodes().any { it.text?.toString() == text && it.isVisibleToUser }
    @Test fun renderedLocalArchiveShowsOriginalTimestampAndExplicitScopedClear() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        val directory = File(instrumentation.targetContext.cacheDir, "local-ui-fixture-${UUID.randomUUID()}").apply { mkdirs() }
        var now = Instant.parse("2026-10-03T08:00:00Z")
        val history = LocalChatHistory(directory) { now }
        val selectedScope = mutableStateOf(LocalChatHistory.scope(null))
        val firstScope = selectedScope.value; val secondScope = "a".repeat(64)
        fun original(id: String, content: String) = JSONObject().put("id", id).put("role", "user").put("content", content).put("createdAt", now.toString())
        history.append(firstScope, original("local", "Synthetic original local request"))
        history.append(secondScope, original("other", "Other paired private original"))
        now = now.plusMillis(LocalChatPolicy.WINDOW_MS); history.rotate(firstScope); history.rotate(secondScope)
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                LocalChatHistoryControls(history, selectedScope.value, 0) { scope -> history.clear(scope) }
            } } } }
            click("Local history")
            await("Saved local summary missing") { visible("You: Synthetic original local request") }
            fun search(query: String) = await("Local search unavailable") {
                nodes().firstOrNull { it.className?.toString() == "android.widget.EditText" }?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
                    Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, query) }) == true
            }
            search("unmatched synthetic query")
            await("Local search did not filter originals") { visible("No archived local conversations match this search.") }
            search("original local")
            await("Local original search missing") { visible("You: Synthetic original local request") }
            click("You: Synthetic original local request")
            await("Original missing") { visible("Synthetic original local request") }
            click("Synthetic original local request")
            await("Original timestamp missing") { nodes().any { it.stateDescription?.toString() == "Timestamp shown" } }
            click("Clear local history"); click("Keep history")
            assertEquals(1, history.page(firstScope).chats.size)
            instrumentation.runOnMainSync { selectedScope.value = secondScope }
            await("Previous pairing archive remained visible") { !visible("Synthetic original local request") && !visible("Clear local history") }
            click("Local history")
            await("New pairing archive missing") { visible("You: Other paired private original") }
            click("Clear local history"); click("Delete local history")
            await("Explicit clear did not finish") { history.page(secondScope).chats.isEmpty() }
            assertEquals(1, history.page(firstScope).chats.size)
        } finally { instrumentation.runOnMainSync { activity.finish() }; directory.deleteRecursively() }
    }
}
