package dev.nakama.companion

import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith

/** Documentation-only synthetic component previews; no saved account, project or pairing state. */
@RunWith(AndroidJUnit4::class)
class AndroidGuideScreenshotsTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    @Test fun captureSanitizedGuidePages() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_"))
        val context = instrumentation.targetContext
        check(PairingVault(context).load() == null)
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        fun show(title: String, content: @Composable () -> Unit) {
            instrumentation.runOnMainSync { activity.setContent {
                MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF315EB4), secondary = Color(0xFF176F5F), background = Color(0xFFF5F7FC), surface = Color.White, surfaceVariant = Color(0xFFE7EDFA))) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Nakama", style = MaterialTheme.typography.headlineSmall)
                            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                            content()
                        }
                    }
                }
            } }
            instrumentation.waitForIdleSync(); SystemClock.sleep(900)
        }
        fun capture(name: String) {
            val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
            java.io.File(context.getExternalFilesDir(null), name + ".png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        try {
            val messages = listOf(
                JSONObject().put("id", "demo1").put("role", "user").put("content", "Set an alarm for 7 tomorrow with birdsong.").put("createdAt", "2026-10-03T08:30:00Z"),
                JSONObject().put("id", "demo2").put("role", "assistant").put("content", "Your one-time alarm is saved for 7 tomorrow on this phone. Android has registered it, and the birdsong clip is downloaded.").put("createdAt", "2026-10-03T08:30:05Z"),
                JSONObject().put("id", "demo3").put("role", "user").put("content", "What else is planned for today?").put("createdAt", "2026-10-03T08:30:10Z"),
                JSONObject().put("id", "demo4").put("role", "assistant").put("content", "You can follow up for 30 seconds after each reply.").put("createdAt", "2026-10-03T08:30:12Z")
            )
            fun call(name: String, value: Any?) {
                val method = MainActivity::class.java.declaredMethods.single { it.name == name && it.parameterCount == 1 }
                method.isAccessible = true; method.invoke(activity, value)
            }
            // Existing instrumentation reflection boundary; never save a token or reach an API.
            val identity = HostIdentity("https://fixture.invalid", "a".repeat(64), "synthetic-documentation", "demo-phone", "Demonstration")
            val snapshot = JSONObject().put("devices", JSONArray().put(JSONObject().put("id", "demo-phone").put("permissions", JSONObject().put("googleAccess", true).put("projectAccess", true))))
                .put("messages", JSONArray(messages.map { it.put("deliveryDeviceId", "demo-phone") }))
            instrumentation.runOnMainSync {
                // Freeze periodic host polling while displaying this in-memory documentation state.
                MainActivity::class.java.getDeclaredField("foreground").apply { isAccessible = true }.setBoolean(activity, false)
                call("setIdentity", identity); call("setStateIdentity", identity); call("setState", snapshot)
                call("setConnection", "Connected · demonstration"); call("setTab", "Chat")
            }
            instrumentation.waitForIdleSync(); SystemClock.sleep(700)
            fun nodes(): List<android.view.accessibility.AccessibilityNodeInfo> {
                val queue = ArrayDeque<android.view.accessibility.AccessibilityNodeInfo>(); val found = mutableListOf<android.view.accessibility.AccessibilityNodeInfo>()
                instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
                while (queue.isNotEmpty() && found.size < 1000) { val node = queue.removeFirst(); found += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
                return found
            }
            capture("android-chat-before")
            var messageNode = nodes().firstOrNull { it.text?.toString()?.contains("You can follow up") == true }
            while (messageNode != null && !messageNode.isClickable) messageNode = messageNode.parent
            check(messageNode?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true) { nodes().joinToString(" | ") { it.text?.toString().orEmpty() } }
            instrumentation.waitForIdleSync(); SystemClock.sleep(300)
            var latest = nodes().firstOrNull { it.text?.toString() == "Latest message" }
            while (latest != null && !latest.isClickable) latest = latest.parent
            latest?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
            instrumentation.waitForIdleSync(); SystemClock.sleep(300)
            // Expanding a timestamp changes the last row height; scroll the real timeline to its end.
            repeat(3) {
                nodes().firstOrNull { it.isScrollable && it.actionList.any { action -> action.id == android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id } }
                    ?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                instrumentation.waitForIdleSync(); SystemClock.sleep(200)
            }
            capture("android-chat")
            instrumentation.runOnMainSync { call("setIdentity", null); call("setStateIdentity", null); call("setState", JSONObject()); call("setConnection", "Not paired") }
            show("Wake word", { FoundationsPanel("Wake word", {}, JSONObject(), "demo-phone", true, { _, _, _ -> JSONObject() }, {}, {}, 0L to "", {}) }); capture("android-wake")
            show("Projects", { ProjectImportPanel(true, { _, path, _ ->
                if (path == "/api/project-imports/roots") JSONObject().put("roots", JSONArray().put(JSONObject().put("id", "demo-library").put("name", "My project library")))
                else if (path.contains("garden-planner")) JSONObject().put("path", "garden-planner").put("canImport", true).put("detected", JSONArray().put("README.md").put("package.json")).put("entries", JSONArray())
                else JSONObject().put("path", "").put("canImport", false).put("detected", JSONArray()).put("entries", JSONArray().put(JSONObject().put("name", "Garden planner").put("path", "garden-planner")).put(JSONObject().put("name", "Recipe notebook").put("path", "recipe-notebook")))
            }, {}, {}) })
            var folderNode = nodes().firstOrNull { it.text?.toString()?.contains("Garden planner") == true }
            while (folderNode != null && !folderNode.isClickable) folderNode = folderNode.parent
            check(folderNode?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true)
            instrumentation.waitForIdleSync(); SystemClock.sleep(400); capture("android-project-import")
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
