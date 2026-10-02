package dev.nakama.companion

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
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
import java.io.ByteArrayOutputStream
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class FoundationsPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    @Test fun platformHttpsClientAcceptsPatchWithoutOpeningAConnection() {
        val connection = java.net.URL("https://127.0.0.1:1").openConnection() as javax.net.ssl.HttpsURLConnection
        try {
            connection.requestMethod = "PATCH"
            assertEquals("PATCH", connection.requestMethod)
        } finally { connection.disconnect() }
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && result.size < 800) { val node = queue.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 12_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun click(text: String) {
        var attempts = 0
        await("Missing control $text") {
            val current = nodes()
            var node = current.firstOrNull { it.text?.toString() == text && it.isVisibleToUser }
            repeat(8) {
                if (node?.isClickable == true && node?.isEnabled == true && node?.isVisibleToUser == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node = node?.parent
            }
            // Routines follows Clock/Monitoring in the scrollable category row. Reveal an
            // offscreen category instead of assuming every chip fits in the emulator viewport.
            if (++attempts % 4 == 0) {
                current.firstOrNull { item -> item.isScrollable && item.actionList.any { it.id == AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT.id } }
                    ?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
            false
        }
    }

    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    @Test fun taskCardsAndRoutineDraftsRenderAndPrivacyRemovalHidesSharedContent() {
        val activity = activity()
        val state = mutableStateOf(JSONObject("""{"taskBoard":{"items":[{"id":"card","title":"Synthetic task","details":"No live action","sourceKind":"manual","completed":false}]},"routineBoard":{"routines":[],"occurrences":[]}}"""))
        val page = mutableStateOf("Tasks"); val allowed = mutableStateOf(true)
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { FoundationsPanel(page.value, { page.value = it }, state.value, "fixture-phone", allowed.value, { method, path, body ->
                calls += "$method $path" to body
                if (method == "PATCH") state.value = JSONObject(state.value.toString()).apply { getJSONObject("taskBoard").getJSONArray("items").getJSONObject(0).put("completed", body!!.getBoolean("completed")) }
                JSONObject()
            }, {}, {}, 0L to "", {}) } } } }
            await("Task card missing") { nodes().any { it.text?.toString() == "Synthetic task" } }
            await("Task checkbox was not clickable") {
                // Compose's category FilterChips also expose CheckBox roles. The task control follows them.
                var checkbox = nodes().lastOrNull { it.className?.toString() == "android.widget.CheckBox" }
                repeat(8) {
                    if (checkbox?.isClickable == true && checkbox?.isEnabled == true) return@await checkbox!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    checkbox = checkbox?.parent
                }
                false
            }
            await("Task mutation missing") { calls.isNotEmpty() }
            assertEquals("PATCH /api/task-board/items/card", calls.single().first); assertTrue(calls.single().second!!.getBoolean("completed"))
            SystemClock.sleep(150)
            instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "foundations-tasks.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
            click("Routines"); click("Add routine")
            await("Routine time field missing") { nodes().any { it.text?.toString() == "09:00" } }
            assertTrue(nodes().any { it.text?.toString() == "Save routine" })
            click("Cancel")
            instrumentation.runOnMainSync { allowed.value = false; page.value = "Tasks" }
            await("Shared content remained after privacy removal") { nodes().none { it.text?.toString() == "Synthetic task" } }
            assertEquals(1, calls.count { !it.first.startsWith("GET ") }); assertEquals(1, calls.count { it.first == "GET /api/device-targets" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun multiTargetAlarmEditsPreserveAllSelectedDevices() {
        val activity = activity()
        val snapshot = JSONObject("""{"routineBoard":{"routines":[{"id":"fixture-alarm","title":"Synthetic alarm","kind":"alarm","time":"09:00","timeZone":"Europe/London","weekdays":[1,2,3,4,5],"enabled":true,"targetDeviceId":"fixture-phone","targetDeviceIds":["fixture-phone","fixture-tablet"]}],"occurrences":[]}}""")
        val directory = JSONObject("""{"sourceDeviceId":"fixture-phone","devices":[{"id":"fixture-phone","name":"Fixture Phone","platform":"android","connected":true},{"id":"fixture-tablet","name":"Fixture Tablet","platform":"android","connected":true},{"id":"desktop","name":"Fixture PC","platform":"desktop","connected":true}]}""")
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) {
                FoundationsPanel("Routines", {}, snapshot, "fixture-phone", true, { method, path, body ->
                    calls += "$method $path" to body?.let { JSONObject(it.toString()) }
                    if (path == "/api/device-targets") directory else JSONObject()
                }, {}, {}, 0L to "", {})
            } } } }
            click("Edit")
            await("Device directory was not requested") { calls.any { it.first == "GET /api/device-targets" } }
            click("Save routine")
            await("Alarm edit was not submitted") { calls.any { it.first == "PATCH /api/routines/fixture-alarm" } }
            val body = calls.single { it.first == "PATCH /api/routines/fixture-alarm" }.second!!
            val targets = body.getJSONArray("targetDeviceIds")
            assertEquals(setOf("fixture-phone", "fixture-tablet"), (0 until targets.length()).map { targets.getString(it) }.toSet())
            assertFalse(body.has("targetDeviceId"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }


    @Test fun remoteScreenUsesSyntheticFramesAndBoundInputsThenStops() {
        val activity = activity()
        val image = Bitmap.createBitmap(900, 500, Bitmap.Config.ARGB_8888)
        Canvas(image).apply { drawColor(Color.rgb(20, 40, 80)); drawText("SYNTHETIC PC FRAME", 80f, 220f, Paint().apply { color = Color.WHITE; textSize = 52f }) }
        val bytes = ByteArrayOutputStream().also { image.compress(Bitmap.CompressFormat.JPEG, 80, it) }.toByteArray(); image.recycle()
        val data = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        val expires = Instant.now().plusSeconds(120).toString()
        var counter = 0
        val voice = mutableStateOf(0L to "")
        val status = JSONObject("""{"available":true,"enabled":true,"permitted":true,"monitors":[{"id":"fixture-display","name":"Fixture monitor","width":900,"height":500,"primary":true}]}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { RemoteDesktopPanel({ method, path, body ->
                calls += "$method $path" to body?.let { JSONObject(it.toString()) }
                when {
                    path.endsWith("/start") -> JSONObject(status.toString()).put("session", JSONObject().put("id", "fixture-session").put("monitorId", "fixture-display").put("expiresAt", expires))
                    path.endsWith("/frame") -> JSONObject().put("sessionId", "fixture-session").put("frameId", "frame-${++counter}").put("monitorId", "fixture-display").put("width", 900).put("height", 500).put("image", data)
                    else -> JSONObject(status.toString())
                }
            }, voice.value, { voice.value = voice.value.first to "" }) } } } }
            click("Connect to PC")
            await("Synthetic frame missing") { nodes().any { it.contentDescription?.toString() == "Live view of selected PC monitor" } }
            SystemClock.sleep(150)
            instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "foundations-remote.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
            instrumentation.runOnMainSync { voice.value = 1L to "input:{\"kind\":\"key\",\"value\":\"Enter\"}" }
            await("Explicit key was not submitted") { calls.any { it.first.endsWith("/input") } }
            val input = calls.first { it.first.endsWith("/input") }.second!!
            assertEquals("fixture-session", input.getString("sessionId")); assertTrue(input.getString("frameId").startsWith("frame-")); assertEquals("Enter", input.getString("key"))
            click("Stop PC control")
            await("Stop request missing") { calls.any { it.first.endsWith("/stop") } }
            await("Frame was not cleared") { nodes().any { it.text?.toString() == "No screen is being received." } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun wakeSetupUsesBundledModelWithoutDownloadOrAndroidServiceSetup() {
        val activity = activity(); val actions = mutableListOf<String>()
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) {
                FoundationsPanel("Wake word", {}, JSONObject(), "fixture-phone", false, { _, _, _ -> fail("Wake setup must not contact the host"); JSONObject() }, {}, actions::add, 0L to "", {})
            } } } }
            await("Bundled wake model explanation missing") { nodes().any { it.text?.toString()?.contains("No Android speech model download or Google recognition service is required") == true } }
            assertFalse(nodes().any { it.text?.toString() == "Download local English model" })
            assertFalse(nodes().any { it.text?.toString() == "Android Voice input settings" })
            await("Wake enable control missing") {
                val current = nodes()
                if (current.any { it.isVisibleToUser && it.text?.toString() == "Enable Nakama wake word" }) true
                else { current.firstOrNull { it.isScrollable && it.actionList.none { action -> action.id == AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT.id } }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD); false }
            }
            click("Enable Nakama wake word")
            await("Wake setup did not invoke local start") { actions == listOf("start_wake") }
            assertFalse(WakeWordService.running)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

}
