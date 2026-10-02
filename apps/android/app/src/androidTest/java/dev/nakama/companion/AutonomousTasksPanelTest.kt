package dev.nakama.companion

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AutonomousTasksPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && result.size < 600) { val node = queue.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun button(text: String): AccessibilityNodeInfo? {
        var node = nodes().firstOrNull { it.text?.toString() == text }
        repeat(6) { if (node?.isClickable == true) return node; node = node?.parent }
        return null
    }
    private fun reveal(text: String, backwards: Boolean = false) {
        repeat(8) {
            if (nodes().any { it.text?.toString() == text }) return
            nodes().firstOrNull { it.isScrollable }?.performAction(if (backwards) AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            SystemClock.sleep(160)
        }
        fail("Missing text: $text")
    }
    @Test fun originatingPhoneSendsExactAnswersAndResumeRevision() {
        val activity = activity()
        val run = JSONObject("""{"id":"phone-run","requestedBy":"phone","goal":"Inspect the local fixture","status":"awaiting_answers","revision":7,"step":1,"questions":[{"id":"scope","question":"Which result matters?"}]}""")
        val calls = mutableListOf<Pair<String, JSONObject>>()
        val drafts = AutonomousTaskDrafts()
        var failAnswer = true
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { AutonomousTasksPanel("phone", true, emptyList(), { method, path, body ->
                if (method == "POST") {
                    calls += path to JSONObject(body!!.toString())
                    when {
                        path.endsWith("/answers") -> {
                            if (failAnswer) { failAnswer = false; error("Simulated task answer failure") }
                            run.put("status", "interrupted").put("revision", 8).put("questions", org.json.JSONArray())
                        }
                        path.endsWith("/resume") -> run.put("status", "running").put("revision", 9)
                        path.endsWith("/stop") -> run.put("status", "stopped")
                        else -> fail("Unexpected mutation")
                    }
                }
                JSONObject().put("runs", org.json.JSONArray().put(JSONObject(run.toString()))).put("capabilities", JSONObject().put("limits", "Fixture only"))
            }, drafts) } } }
            await("Task panel did not load") { nodes().any { it.text?.toString() == "Fixture only" } }
            reveal("Which result matters?")
            // Compose exposes the label as a separate accessibility node. The
            // question is the last editable field after the goal form.
            val field = nodes().filter { it.isEditable }.last()
            assertTrue(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "  Local preview  ") }))
            reveal("Send task answers")
            await("Answer stayed disabled") { button("Send task answers")?.isEnabled == true }
            button("Send task answers")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Answer request missing") { calls.size == 1 }
            assertEquals(7, calls[0].second.getInt("revision"))
            assertEquals("scope", calls[0].second.getJSONArray("answers").getJSONObject(0).getString("id"))
            assertEquals("Local preview", calls[0].second.getJSONArray("answers").getJSONObject(0).getString("answer"))
            // A successful progress poll must not erase a failed action's
            // explanation or its unsent answer draft.
            SystemClock.sleep(6500)
            assertEquals("  Local preview  ", drafts.answers["phone-run:scope"])
            reveal("Simulated task answer failure", backwards = true)
            reveal("Send task answers")
            button("Send task answers")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Retried answer request missing") { calls.size == 2 }
            reveal("Resume task")
            button("Resume task")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Resume request missing") { calls.size == 3 }
            assertEquals(8, calls[2].second.getInt("revision"))
            reveal("Stop autonomous task")
            button("Stop autonomous task")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Stop request missing") { calls.size == 4 }
            assertEquals(0, calls[3].second.length())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun revokedAccessDiscardsLateProgressAndClearsDrafts() {
        val activity = activity()
        val notice = AttentionPolicy.notices(JSONObject("""{"version":1,"items":[{"id":"autonomous:run:q","kind":"question","autonomousRunId":"run","questionId":"q"}]}""")).single()
        assertEquals("run", notice.autonomousRunId)
        assertEquals("q", notice.questionId)
        assertFalse(AttentionPolicy.supportsVoiceAnswer(notice))
        val allowed = mutableStateOf(true)
        val response = CompletableDeferred<JSONObject>()
        val drafts = AutonomousTaskDrafts().apply { identityKey = "phone"; goal = "Private unsent goal" }
        var requested = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { AutonomousTasksPanel("phone", allowed.value, emptyList(), { method, _, _ ->
                assertEquals("GET", method); requested = true; response.await()
            }, drafts) } } }
            await("Read did not begin") { requested }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Permission explanation missing") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            response.complete(JSONObject("""{"runs":[{"id":"late","goal":"Late private result","requestedBy":"phone","status":"running"}]}"""))
            SystemClock.sleep(250)
            assertFalse(nodes().any { it.text?.toString()?.contains("Late private result") == true })
            assertEquals("", drafts.goal)
            assertTrue(drafts.answers.isEmpty())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun sharedRunCannotBeAnsweredStoppedOrResumedByAnotherPhone() {
        val activity = activity()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { AutonomousTasksPanel("phone", true, emptyList(), { method, _, _ ->
                assertEquals("GET", method)
                JSONObject("""{"runs":[{"id":"other","goal":"Shared task","requestedBy":"another-phone","status":"awaiting_answers","revision":2,"questions":[{"id":"q","question":"Shared question"}]}]}""")
            }) } } }
            reveal("Shared question")
            assertNull(button("Send task answers"))
            assertNull(button("Stop autonomous task"))
            assertNull(button("Resume task"))
            assertTrue(nodes().any { it.text?.toString()?.contains("device that started this task") == true })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
