package dev.nakama.companion

import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AgentOfficePanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val pending = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(pending::add)
        while (pending.isNotEmpty() && result.size < 1000) { val node = pending.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(pending::add) }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun click(label: String) = await("Missing control $label") {
        var node = nodes().firstOrNull { it.text?.toString() == label || it.contentDescription?.toString() == label }
        repeat(8) { if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK); node = node?.parent }
        false
    }
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    @Suppress("UNCHECKED_CAST") private fun set(activity: MainActivity, name: String, value: Any?) {
        val delegated = MainActivity::class.java.declaredFields.firstOrNull { it.name == "$name\$delegate" }
        if (delegated != null) { delegated.isAccessible = true; (delegated.get(activity) as MutableState<Any?>).value = value }
        else {
            val field = MainActivity::class.java.declaredFields.firstOrNull { it.name == name }
            if (field != null) { field.isAccessible = true; field.set(activity, value) }
            else MainActivity::class.java.declaredMethods.first { it.name == "set" + name.replaceFirstChar(Char::uppercaseChar) }.apply { isAccessible = true }.invoke(activity, value)
        }
    }
    @Suppress("UNCHECKED_CAST") private fun get(activity: MainActivity, name: String): Any? {
        val delegated = MainActivity::class.java.declaredFields.firstOrNull { it.name == "$name\$delegate" }
        return if (delegated != null) { delegated.isAccessible = true; (delegated.get(activity) as MutableState<Any?>).value }
        else {
            val field = MainActivity::class.java.declaredFields.firstOrNull { it.name == name }
            if (field != null) { field.isAccessible = true; field.get(activity) }
            else MainActivity::class.java.getDeclaredMethod("get" + name.replaceFirstChar(Char::uppercaseChar)).apply { isAccessible = true }.invoke(activity)
        }
    }
    private fun fakeVoice(activity: MainActivity): Pair<VoiceController, FakeVoiceServices> {
        (get(activity, "voice") as VoiceController).close()
        val services = FakeVoiceServices()
        val voice = VoiceController(services, MemoryVoicePreferences(), {}, {})
        set(activity, "voice", voice)
        return voice to services
    }

    @Test fun desksUseRealRecordsShowHierarchyAndHideImmediatelyOnRevocation() {
        val activity = activity(); val allowed = mutableStateOf(true)
        val office = JSONObject("""{"version":1,"agents":[{"id":"workflow:fixture","name":"Haru","providerId":"codex","role":"project_manager","title":"Synthetic garden project","status":"running","phase":"reviewing","model":"fixture-gpt","requestedEffort":"ultra","effectiveEffort":"ultra","createdAt":"2026-10-02T00:00:00Z","updatedAt":"2026-10-02T00:01:00Z"},{"id":"task:fixture","parentId":"workflow:fixture","name":"Aki","providerId":"claude","role":"developer","title":"Synthetic garden worker","status":"failed","phase":"implementing","output":"Fixture output only","error":"Fixture check failed","model":"fixture-claude","requestedEffort":"ultracode","effectiveEffort":"xhigh","createdAt":"2026-10-02T00:00:10Z","updatedAt":"2026-10-02T00:01:00Z"}]}""")
        office.getJSONArray("agents").getJSONObject(0).put("sourceKind", "workflow").put("receiptKind", "workflow_orchestration")
        office.getJSONArray("agents").getJSONObject(1).put("sourceKind", "task").put("receiptKind", "model_task")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { AgentOfficePanel(office, allowed.value) } } } }
            await("Office desks missing") { nodes().any { it.text?.toString() == "Haru" } && nodes().any { it.text?.toString() == "Aki" } }
            SystemClock.sleep(200)
            instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "agent-office.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
            click("Open agent Aki")
            await("Recorded error missing") { nodes().any { it.text?.toString() == "Fixture check failed" } }
            assertTrue(nodes().any { it.text?.toString() == "Fixture output only" })
            click("Reports to Haru")
            await("Parent phase missing") { nodes().any { it.text?.toString()?.contains("Phase: reviewing") == true } }
            assertTrue(nodes().any { it.text?.toString() == "Delegated work" })
            assertTrue(nodes().any { it.text?.toString() == "Workflow coordinator · saved stage" })
            instrumentation.runOnMainSync { allowed.value = false }
            await("Private office detail survived revoked access") { nodes().none { it.text?.toString() == "Haru" || it.text?.toString() == "Aki" || it.text?.toString() == "Fixture output only" } }
            await("Privacy notice missing after dialog dismissal") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            instrumentation.runOnMainSync { office.put("version", 99); allowed.value = true }
            await("Unsupported office contract was rendered") { nodes().any { it.text?.toString()?.contains("supported Agent office snapshot") == true } }
            assertTrue(nodes().none { it.text?.toString() == "Haru" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun localPageNavigationRemainsAvailableDuringRequestAcceptanceWithoutHostOrPhoneActions() {
        val activity = activity()
        try {
            instrumentation.runOnMainSync {
                fakeVoice(activity)
                set(activity, "busy", true)
                val dispatch = MainActivity::class.java.getDeclaredMethod("acceptVoiceText", String::class.java).apply { isAccessible = true }
                dispatch.invoke(activity, "Nakama, open agent office")
                assertEquals("Tools", get(activity, "tab")); assertEquals("Agent office", get(activity, "foundationPage"))
                dispatch.invoke(activity, "open core memory")
                assertEquals("Core Memory", get(activity, "foundationPage"))
                dispatch.invoke(activity, "open projects")
                assertEquals("Projects", get(activity, "tab"))
                dispatch.invoke(activity, "open home")
                assertEquals("Home", get(activity, "tab"))
                assertEquals("needs_permission", NakamaAccessibilityService.navigateFromUser("notifications", null).status)
            }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun acknowledgementsDoNotConsumeFinalsAndMultipleResultsWaitForSpeechAcrossMicSessions() {
        val activity = activity()
        try {
            instrumentation.runOnMainSync {
                val (voice, services) = fakeVoice(activity)
                val identity = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
                val snapshot = JSONObject("""{"devices":[{"id":"phone","permissions":{"googleAccess":true,"projectAccess":true}}],"messages":[{"id":"ack","role":"assistant","kind":"task_ack","taskIds":["one"],"content":"Accepted your fixture work"}],"tasks":[],"projectWorkflows":[]}""")
                set(activity, "identity", identity); set(activity, "stateIdentity", identity); set(activity, "state", snapshot); set(activity, "connection", "Connected to Fixture")
                val epoch = get(activity, "replySession") as Long
                @Suppress("UNCHECKED_CAST") val pending = get(activity, "pendingSpeechTasks") as MutableMap<String, Long>
                pending["one"] = epoch
                val deliver = MainActivity::class.java.getDeclaredMethod("deliverPendingReplies", JSONObject::class.java, java.lang.Long.TYPE).apply { isAccessible = true }
                deliver.invoke(activity, snapshot, epoch)
                assertEquals("Accepted your fixture work", services.output.spoken.last().first); assertTrue(pending.containsKey("one"))
                services.output.finished(services.output.spoken.last().second, true)
                val oldMic = voice.session
                voice.listen(); services.requests.last().result("A follow-up fixture question")
                assertTrue(voice.session > oldMic)
                pending["two"] = epoch
                snapshot.getJSONArray("messages").put(JSONObject("""{"id":"done-one","role":"assistant","taskId":"one","content":"First finished result"}"""))
                snapshot.getJSONArray("messages").put(JSONObject("""{"id":"done-two","role":"assistant","taskId":"two","content":"Second finished result"}"""))
                set(activity, "tab", "Tools")
                deliver.invoke(activity, snapshot, epoch)
                assertEquals("First finished result", services.output.spoken.last().first); assertTrue(pending.containsKey("two"))
                deliver.invoke(activity, snapshot, epoch)
                assertEquals(2, services.output.spoken.size)
                services.output.finished(services.output.spoken.last().second, true)
                deliver.invoke(activity, snapshot, epoch)
                assertEquals("Second finished result", services.output.spoken.last().first); assertTrue(pending.isEmpty())
                services.output.finished(services.output.spoken.last().second, true)
                @Suppress("UNCHECKED_CAST") val workflowPending = get(activity, "pendingSpeechWorkflows") as MutableMap<String, Long>
                workflowPending["workflow"] = epoch
                snapshot.getJSONArray("projectWorkflows").put(JSONObject("""{"id":"workflow","status":"running"}"""))
                snapshot.getJSONArray("messages").put(JSONObject("""{"id":"old-question","workflowId":"workflow","role":"assistant","kind":"project_questions","content":"Already answered question"}"""))
                deliver.invoke(activity, snapshot, epoch)
                assertEquals("Answered questions must not replay while work runs", 3, services.output.spoken.size)
                snapshot.getJSONArray("projectWorkflows").getJSONObject(0).put("status", "awaiting_answers")
                snapshot.getJSONArray("messages").put(JSONObject("""{"id":"current-question","workflowId":"workflow","role":"assistant","kind":"project_questions","content":"Current question"}"""))
                deliver.invoke(activity, snapshot, epoch)
                assertEquals("Current question", services.output.spoken.last().first)
                MainActivity::class.java.getDeclaredMethod("stopConversation").apply { isAccessible = true }.invoke(activity)
                pending["late"] = epoch
                deliver.invoke(activity, snapshot, epoch)
                assertEquals(4, services.output.spoken.size)
                set(activity, "identity", null); set(activity, "stateIdentity", null)
            }
        } finally { instrumentation.runOnMainSync { set(activity, "identity", null); activity.finish() } }
    }

    @Test fun lateMemoryResponseCannotRevealNotesAfterPrivacyRemoval() {
        val activity = activity(); val allowed = mutableStateOf(true); val response = CompletableDeferred<JSONObject>(); var called = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { CoreMemoryPanel("fixture", allowed.value) { method, path, _ -> assertEquals("GET", method); assertEquals("/api/core-memory", path); called = true; response.await() } } } } }
            await("Memory request missing") { called }
            instrumentation.runOnMainSync { allowed.value = false; response.complete(JSONObject("""{"entries":[{"id":"secret-fixture","category":"note","text":"LATE PRIVATE FIXTURE"}]}""")) }
            await("Memory privacy screen missing") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            assertTrue(nodes().none { it.text?.toString() == "LATE PRIVATE FIXTURE" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun delayedNavigationCannotReplaceNewInputOrNewPageAndUnknownProjectsAreRejected() {
        val activity = activity()
        try {
            instrumentation.runOnMainSync {
                fakeVoice(activity)
                val identity = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
                set(activity, "identity", identity); set(activity, "stateIdentity", identity); set(activity, "connection", "Connected to Fixture")
                set(activity, "state", JSONObject("""{"devices":[{"id":"phone","permissions":{"googleAccess":true,"projectAccess":true}}],"projects":[{"id":"fixture-project"}]}"""))
                val gate = get(activity, "navigationReceipts") as NavigationReceiptGate
                val apply = MainActivity::class.java.getDeclaredMethod("applyNavigationReceipt", JSONObject::class.java, java.lang.Long.TYPE).apply { isAccessible = true }
                val edit = MainActivity::class.java.getDeclaredMethod("editDraft", String::class.java).apply { isAccessible = true }
                val receipt = JSONObject("""{"type":"navigate","target":"projects","projectId":"fixture-project"}""")
                val first = gate.begin(); edit.invoke(activity, "A newer draft")
                apply.invoke(activity, receipt, first)
                assertEquals("Home", get(activity, "tab")); assertEquals("A newer draft", get(activity, "draft"))
                val second = gate.begin(); set(activity, "tab", "Tools"); set(activity, "foundationPage", "Agent office")
                apply.invoke(activity, receipt, second)
                assertEquals("Tools", get(activity, "tab")); assertEquals("Agent office", get(activity, "foundationPage"))
                apply.invoke(activity, JSONObject("""{"type":"navigate","target":"projects","projectId":"not-visible"}"""), gate.begin())
                assertEquals("Tools", get(activity, "tab")); assertEquals("", get(activity, "selectedProject"))
                apply.invoke(activity, JSONObject("""{"type":"navigate","target":"settings","projectId":"fixture-project"}"""), gate.begin())
                assertEquals("Tools", get(activity, "tab"))
                apply.invoke(activity, receipt, gate.begin())
                assertEquals("Chat", get(activity, "tab")); assertEquals("fixture-project", get(activity, "selectedProject"))
                set(activity, "identity", null); set(activity, "stateIdentity", null)
            }
        } finally { instrumentation.runOnMainSync { set(activity, "identity", null); activity.finish() } }
    }
}
