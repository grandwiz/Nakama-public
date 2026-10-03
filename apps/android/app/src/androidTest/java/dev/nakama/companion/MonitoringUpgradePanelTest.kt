package dev.nakama.companion

import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MonitoringUpgradePanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        // Scrolling can leave descendants at their prior bounds in UiAutomation's node cache.
        instrumentation.uiAutomation.clearCache()
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
        repeat(14) {
            if (nodes().any { it.text?.toString() == text }) return
            val candidates = nodes()
            val vertical = candidates.firstOrNull { node -> node.isScrollable && node.actionList.any { it.id in setOf(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id, AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP.id) } }
                ?: candidates.firstOrNull { node -> node.isScrollable && node.actionList.none { it.id in setOf(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT.id, AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT.id) } }
            vertical?.performAction(if (backwards) AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            SystemClock.sleep(160)
        }
        fail("Missing text: $text")
    }
    @Test fun monitorCreationIsPausedAndControlsUseCurrentRevision() {
        val activity = activity()
        val drafts = MonitoringDrafts().apply { identityKey = "phone"; title = "Synthetic stock"; target = "https://shop.invalid/item"; conditionType = "text"; contains = "In stock"; excludes = "Out of stock" }
        val rows = JSONArray(); val calls = mutableListOf<Pair<String, JSONObject>>()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { MonitoringPanel("phone", true, true, { method, path, body ->
                if (method == "POST") {
                    calls += path to JSONObject(body!!.toString())
                    when (path) {
                        "/api/monitors" -> rows.put(JSONObject().put("id", "fixture").put("title", "Synthetic stock").put("kind", "website").put("status", "paused").put("revision", 2))
                        "/api/monitors/fixture/resume" -> rows.getJSONObject(0).put("status", "active").put("revision", 3)
                        "/api/monitors/fixture/pause" -> rows.getJSONObject(0).put("status", "paused").put("revision", 4)
                        else -> fail("Unexpected monitor mutation $path")
                    }
                }
                JSONObject().put("monitors", JSONArray(rows.toString())).put("detail", "Synthetic monitor fixture")
            }, {}, drafts) } } }
            await("Monitor fixture did not load") { nodes().any { it.text?.toString() == "Synthetic monitor fixture" } }
            reveal("Save paused monitor"); button("Save paused monitor")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Create was not called") { calls.size == 1 }
            assertEquals(60, calls[0].second.getInt("intervalSeconds")); assertEquals("website", calls[0].second.getString("kind"))
            assertEquals("https://shop.invalid/item", calls[0].second.getString("url")); assertFalse(calls[0].second.has("status"))
            assertEquals("In stock", calls[0].second.getJSONObject("condition").getString("contains"))
            reveal("Resume monitor"); button("Resume monitor")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Resume was not called") { calls.size == 2 }; assertEquals(2, calls[1].second.getInt("revision"))
            await("Resumed monitor did not expose Pause") { button("Pause monitor")?.isEnabled == true }
            button("Pause monitor")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Pause was not called") { calls.size == 3 }; assertEquals(3, calls[2].second.getInt("revision"))
            assertEquals("", drafts.target)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun revokedMonitorAccessDropsLateResultAndPrivateDraft() {
        val activity = activity(); val allowed = mutableStateOf(true); val response = CompletableDeferred<JSONObject>(); var requested = false
        val drafts = MonitoringDrafts().apply { identityKey = "phone"; title = "Private draft"; contains = "Private condition" }
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { MonitoringPanel("phone", allowed.value, true, { _, _, _ -> requested = true; response.await() }, {}, drafts) } } }
            await("Read did not begin") { requested }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Privacy explanation missing") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            response.complete(JSONObject("""{"monitors":[{"id":"late","title":"Late private monitor"}]}"""))
            SystemClock.sleep(250)
            assertFalse(nodes().any { it.text?.toString()?.contains("Late private monitor") == true }); assertEquals("", drafts.title); assertEquals("", drafts.contains)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun maintenanceSavesWithoutStartingAndRetainsFailedDraft() {
        val activity = activity(); val calls = mutableListOf<Pair<String, JSONObject>>(); var failSave = true
        val drafts = SelfMaintenanceDrafts().apply { identityKey = "phone"; title = "Synthetic feature"; request = "Add a fixture display" }
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { SelfMaintenancePanel("phone", true, { method, path, body ->
                if (method == "POST") {
                    assertEquals("/api/self-maintenance", path); calls += path to JSONObject(body!!.toString())
                    if (failSave) { failSave = false; error("Synthetic save failure") }
                }
                JSONObject("""{"settings":{"hold":true},"requests":[],"capabilities":{"detail":"Synthetic upgrade fixture"}}""")
            }, { _, _ -> fail("No workflow should start") }, drafts) } } }
            await("Upgrade fixture did not load") { nodes().any { it.text?.toString() == "Synthetic upgrade fixture" } }
            reveal("Save improvement request"); button("Save improvement request")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Save missing") { calls.size == 1 }; assertEquals("Add a fixture display", drafts.request)
            reveal("Synthetic save failure"); SystemClock.sleep(6200)
            assertEquals("Add a fixture display", drafts.request)
            reveal("Save improvement request", backwards = true); button("Save improvement request")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Second save missing") { calls.size == 2 }; await("Draft not cleared after save") { drafts.request.isBlank() }
            assertFalse(calls.any { it.first.contains("start") || it.first.contains("install") })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun upgradedAttentionSchemaIsGenericAndTypedOnly() {
        val notices = AttentionPolicy.notices(JSONObject("""{"version":1,"items":[{"id":"m:1","kind":"monitor","monitorId":"one"},{"id":"u:1","kind":"upgrade","selfMaintenanceId":"two"}]}"""))
        assertEquals(2, notices.size); assertEquals("one", notices[0].monitorId); assertEquals("two", notices[1].selfMaintenanceId)
        assertTrue(notices.none(AttentionPolicy::supportsVoiceAnswer))
    }
    @Test fun privateBrowserResultCannotNavigateAfterRevocation() {
        val activity = activity(); val allowed = mutableStateOf(true); val response = CompletableDeferred<JSONObject>()
        var requested = false; var opened = false
        try {
            val fixtureInsets = activity.window.decorView.rootWindowInsets.getInsetsIgnoringVisibility(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
            val fixtureDensity = activity.resources.displayMetrics.density
            // Match the production Scaffold safe viewport when replacing its composition.
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().padding(top = (fixtureInsets.top / fixtureDensity).dp, bottom = (fixtureInsets.bottom / fixtureDensity).dp)) { MonitoringPanel("phone", allowed.value, allowed.value, { method, path, body ->
                if (method == "POST") {
                    assertEquals("/api/monitors/fixture/open", path); assertEquals(4, body!!.getInt("revision")); assertEquals("setup", body.getString("reason"))
                    requested = true; withContext(NonCancellable) { response.await() }
                } else JSONObject("""{"monitors":[{"id":"fixture","title":"Private handoff fixture","kind":"website","status":"attention","revision":4}]}""")
            }, { opened = true }) } } } }
            reveal("Open private setup"); button("Open private setup")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Open not requested") { requested }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Privacy explanation missing") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            response.complete(JSONObject("""{"sessionId":"private-fixture","outcome":{"type":"navigate","target":"browser","browserSessionId":"private-fixture"}}"""))
            SystemClock.sleep(250); assertFalse(opened)
        } finally { response.complete(JSONObject()); instrumentation.runOnMainSync { activity.finish() } }
    }
}
