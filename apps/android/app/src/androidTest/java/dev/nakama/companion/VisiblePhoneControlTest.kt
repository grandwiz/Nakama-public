package dev.nakama.companion

import android.app.Activity
import android.app.UiAutomation
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** A disposable test-only app screen: no accounts, networking, messages, calls or purchases. */
class ControlTargetActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24, 240, 24, 24)
            addView(TextView(this@ControlTargetActivity).apply { text = "Nakama disposable control fixture" })
            addView(Button(this@ControlTargetActivity).apply { isAllCaps = false; text = "Fixture action"; setOnClickListener { text = "Fixture clicked" } })
        })
    }
}

@RunWith(AndroidJUnit4::class)
class VisiblePhoneControlTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val automation get() = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
    private fun shell(command: String) = automation.executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes().decodeToString().trim() }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 12_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(100) }
        fail(message)
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        automation.windows.forEach { it.root?.let(queue::add) }
        while (queue.isNotEmpty() && result.size < 600) { val node = queue.removeFirst(); result += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
        return result
    }
    @Test fun visibleControlCanTapFixtureAndStopInvalidatesInflightSession() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        val originalServices = shell("settings get secure enabled_accessibility_services")
        val originalEnabled = shell("settings get secure accessibility_enabled")
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        shell("pm grant dev.nakama.companion android.permission.POST_NOTIFICATIONS")
        shell("cmd appops set dev.nakama.companion SYSTEM_ALERT_WINDOW allow")
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            shell("settings put secure enabled_accessibility_services dev.nakama.companion/.NakamaAccessibilityService")
            shell("settings put secure accessibility_enabled 1")
            await("Accessibility service did not connect") { NakamaAccessibilityService.connected }
            instrumentation.runOnMainSync { activity.startForegroundService(Intent(activity, MascotOverlayService::class.java)) }
            await("Mascot did not start") { MascotOverlayService.running }
            var result: ActionResult? = null
            instrumentation.runOnMainSync { result = NakamaAccessibilityService.startSession("dev.nakama.companion.test") }
            assertEquals(result?.message, "completed", result?.status)
            val token = NakamaAccessibilityService.sessionToken
            await("Visible Stop button missing") { nodes().any { it.contentDescription?.toString() == "Stop Nakama phone control now" } }
            instrumentation.targetContext.startActivity(Intent().setComponent(ComponentName("dev.nakama.companion.test", ControlTargetActivity::class.java.name)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            await("Disposable control target did not open") { nodes().any { it.text?.toString() == "Fixture action" } }
            instrumentation.runOnMainSync { result = NakamaAccessibilityService.execute("ui_read", JSONObject().put("packageName", "dev.nakama.companion.test"), token) }
            assertEquals(result?.message, "completed", result?.status)
            assertTrue(result?.data?.optJSONArray("controls").toString().contains("Fixture action"))
            instrumentation.runOnMainSync { result = NakamaAccessibilityService.execute("ui_tap", JSONObject().put("packageName", "dev.nakama.companion.test").put("text", "Fixture action"), token) }
            assertEquals(result?.message, "started", result?.status)
            await("Requested fixture control was not tapped") { nodes().any { it.text?.toString() == "Fixture clicked" } }
            SystemClock.sleep(120) // Let SurfaceFlinger compose the requested cursor before the evidence snapshot.
            automation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "control-fixture.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
            val stop = nodes().first { it.contentDescription?.toString() == "Stop Nakama phone control now" }
            assertTrue(stop.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            await("Floating Stop did not end session") { !NakamaAccessibilityService.sessionActive && NakamaAccessibilityService.activePackage.isBlank() }
            await("Stop button was not removed") { nodes().none { it.contentDescription?.toString() == "Stop Nakama phone control now" } }
            instrumentation.runOnMainSync { result = NakamaAccessibilityService.startSession("dev.nakama.companion.test") }
            assertEquals("completed", result?.status)
            instrumentation.runOnMainSync { result = NakamaAccessibilityService.execute("ui_read", JSONObject().put("packageName", "dev.nakama.companion.test"), token) }
            assertEquals("needs_permission", result?.status)
            instrumentation.runOnMainSync { NakamaAccessibilityService.stopSession() }
        } finally {
            instrumentation.runOnMainSync { NakamaAccessibilityService.stopSession(); activity.finish() }
            instrumentation.targetContext.stopService(Intent(instrumentation.targetContext, MascotOverlayService::class.java))
            shell(if (originalServices == "null") "settings delete secure enabled_accessibility_services" else "settings put secure enabled_accessibility_services $originalServices")
            shell(if (originalEnabled == "null") "settings delete secure accessibility_enabled" else "settings put secure accessibility_enabled $originalEnabled")
            shell("cmd appops set dev.nakama.companion SYSTEM_ALERT_WINDOW deny")
        }
    }
}
