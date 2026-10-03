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
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class ChatTimelineTest {
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
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun message(id: String, content: String, role: String = "assistant") = JSONObject().put("id", id).put("content", content).put("role", role).put("createdAt", "2026-10-03T10:20:30Z")

    @Test fun timestampsUnreadJumpAndOwnSubmissionUseRenderedConversation() {
        val activity = activity()
        val messages = mutableStateOf((1..45).map { message("m$it", "Synthetic message $it. This conversation contains no account data.") })
        val submission = mutableStateOf<ChatSubmission?>(null)
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                ChatTimeline(messages.value, "fixture", submission.value, Modifier.fillMaxSize())
            } } } }
            val last = messages.value.last().getString("content")
            await("Initial latest message missing") { visible(last) }
            click(last)
            await("Tapping message did not expose timestamp") { nodes().any { it.stateDescription?.toString() == "Timestamp shown" } }
            await("Could not scroll away from latest") {
                nodes().firstOrNull { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
                visible("Latest message")
            }
            SystemClock.sleep(250)
            instrumentation.runOnMainSync { messages.value = messages.value + message("incoming", "New synthetic incoming message") }
            await("Unread latest control missing") { visible("Latest · 1 unread") }
            assertFalse("An incoming message stole the reading position", visible("New synthetic incoming message"))
            click("Latest · 1 unread")
            await("Latest did not reveal incoming message") { visible("New synthetic incoming message") }
            await("Could not scroll away before submitting") {
                nodes().firstOrNull { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
                visible("Latest message")
            }
            instrumentation.runOnMainSync {
                submission.value = ChatSubmission("submission-1", "My new synthetic request")
                messages.value = messages.value + message("own", "My new synthetic request", "user")
            }
            await("Own submission did not come into view") { visible("My new synthetic request") }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun archiveSearchCompletionAndPermissionRemovalUseRenderedControls() {
        val activity = activity()
        val chat = JSONObject("""{"id":"fixture-chat","revision":3,"projectId":null,"deliveryDeviceId":"fixture-phone","status":"active","canComplete":true,"messageCount":2,"startedAt":"2026-10-03T10:20:30Z","summary":"Synthetic saved summary"}""")
        val state = mutableStateOf(JSONObject().put("chatHistory", JSONObject().put("chats", JSONArray().put(chat))))
        val allowed = mutableStateOf(true)
        val calls = CopyOnWriteArrayList<Pair<String, JSONObject?>>()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                ChatHistoryControls(state.value, "fixture-phone", "", allowed.value, { method, path, body ->
                    calls += "$method $path" to body
                    when {
                        method == "POST" -> { assertEquals(3, body!!.getInt("revision")); chat.put("status", "completed").put("canComplete", false); JSONObject().put("chat", chat) }
                        path.startsWith("/api/chats?") -> JSONObject().put("chats", JSONArray().put(chat)).put("nextCursor", JSONObject.NULL)
                        else -> JSONObject().put("chat", chat).put("messages", JSONArray().put(message("saved", "Archived synthetic original message")))
                    }
                }, { state.value = JSONObject(state.value.toString()) })
            } } } }
            click("Complete chat")
            await("Completed chat remains a current control") { !visible("Complete chat") }
            click("Chat history")
            await("Archive metadata missing") { visible("Synthetic saved summary") }
            await("Archive search field missing") {
                nodes().firstOrNull { it.className?.toString() == "android.widget.EditText" }?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
                    Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "original message") }) == true
            }
            await("Search query did not reach scoped host API") { calls.any { it.first == "GET /api/chats?q=original+message" } }
            click("Synthetic saved summary")
            await("Archive original transcript missing") { visible("Archived synthetic original message") }
            click("Archived synthetic original message")
            await("Archived timestamp missing") { nodes().any { it.stateDescription?.toString() == "Timestamp shown" } }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Archive remained visible after permission removal") { !visible("Archived synthetic original message") && !visible("Chat history") }
            assertEquals(1, calls.count { it.first.startsWith("POST ") })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun completedAgentDesksAreHiddenUntilHistoryIsRequested() {
        val activity = activity()
        val office = JSONObject("""{"version":1,"agents":[{"id":"done","name":"Finished fixture manager","status":"completed","providerId":"codex","role":"manager"},{"id":"working","parentId":"done","name":"Working fixture agent","status":"running","providerId":"codex","role":"worker"}]}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) { AgentOfficePanel(office, true) } } } }
            await("Unfinished agent missing") { nodes().any { it.contentDescription?.toString() == "Open agent Working fixture agent" } }
            assertFalse(nodes().any { it.contentDescription?.toString() == "Open agent Finished fixture manager" })
            click("Including history 2")
            await("Explicit history did not restore completed desk") { nodes().any { it.contentDescription?.toString() == "Open agent Finished fixture manager" } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
