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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProjectWorkflowPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && result.size < 500) { val node = queue.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
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
    @Test fun managerQuestionsRequireAnswersAndPreserveExactQuestionIds() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val workflow = JSONObject("""{"id":"fixture-workflow","status":"awaiting_answers","stage":"awaiting_answers","questions":[{"id":"manager-question","text":"Which colour should the fixture use?"}]}""")
        val busy = mutableStateOf(false)
        val allowed = mutableStateOf(true)
        var submission: JSONObject? = null
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { if (allowed.value) ProjectWorkflowPanel(workflow, true, busy.value, { submission = it; busy.value = true }, {}) } } }
            await("Manager question missing") { nodes().any { it.text?.toString() == "Which colour should the fixture use?" } }
            assertFalse(button("Send answers to manager")!!.isEnabled)
            val field = nodes().first { it.isEditable }
            assertTrue(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "Blue fixture") }))
            await("Answered question did not become submittable") { button("Send answers to manager")?.isEnabled == true }
            assertTrue(button("Send answers to manager")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            await("Answer callback missing") { submission != null }
            assertEquals("manager-question", submission!!.getJSONArray("answers").getJSONObject(0).getString("id"))
            assertEquals("Blue fixture", submission!!.getJSONArray("answers").getJSONObject(0).getString("answer"))
            await("Duplicate submission remains enabled") { button("Send answers to manager")?.isEnabled == false }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Permission removal did not clear sensitive panel") { nodes().none { it.text?.toString()?.contains("Blue fixture") == true } }
            instrumentation.runOnMainSync { allowed.value = true; busy.value = false }
            await("Panel did not return") { nodes().any { it.isEditable } }
            assertTrue(nodes().filter { it.isEditable }.all { it.text?.toString()?.contains("Blue fixture") != true })
            assertFalse(button("Send answers to manager")!!.isEnabled)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun checkApprovalRemainsOnPcAndReceiptsShowTheActualExitResult() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val workflow = mutableStateOf(JSONObject("""{"id":"fixture-checks","status":"running","stage":"awaiting_check_approval","questions":[],"checkReceipts":[{"checkName":"test","round":0,"status":"failed","exitCode":1},{"checkName":"test","round":1,"status":"awaiting_approval"}]}"""))
        var stopped = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ProjectWorkflowPanel(workflow.value, true, false, { fail("Check approval must not send an answer") }, { stopped = true }) } } }
            await("PC approval stage missing") { nodes().any { it.text?.toString() == "Project check needs your PC approval" } }
            assertTrue(nodes().any { it.text?.toString()?.contains("This phone cannot approve it.") == true })
            assertNull(button("Send answers to manager"))
            assertTrue(button("Read project check results (2)")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            await("Failed check exit result missing") { nodes().any { it.text?.toString() == "test · round 0 · failed · exit 1" } }
            assertTrue(nodes().any { it.text?.toString() == "This check has not started." })
            assertTrue(button("Stop project workflow")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            await("Workflow stop callback missing") { stopped }
            instrumentation.runOnMainSync { workflow.value = JSONObject(workflow.value.toString()).put("status", "stopped") }
            await("Stopped workflow still presented as waiting") { nodes().any { it.text?.toString() == "Project workflow stopped" } }
            assertFalse(nodes().any { it.text?.toString()?.contains("This phone cannot approve it.") == true })
            assertNull(button("Stop project workflow"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
