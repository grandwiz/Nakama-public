package dev.nakama.companion

import android.content.Intent
import android.content.ComponentName
import android.os.Build
import android.os.SystemClock
import android.accessibilityservice.AccessibilityService
import android.provider.Settings
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
class AutomaticCompanionTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun await(message: String, check: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 12_000
        while (SystemClock.uptimeMillis() < end) { if (check()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val found = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && found.size < 1000) { val node = queue.removeFirst(); found += node; for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add) }
        return found
    }
    private fun visible(value: String) = nodes().any { it.isVisibleToUser && it.text?.toString()?.contains(value) == true }
    private fun click(text: String) {
        await("Expected control: $text") {
            var node = nodes().firstOrNull { it.isVisibleToUser && it.text?.toString() == text }
            repeat(8) { if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK); node = node?.parent }
            false
        }
    }
    private fun shell(command: String) { instrumentation.uiAutomation.executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() } }
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Run on the disposable Android emulator only." }
        PairingVault(instrumentation.targetContext).clear()
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).putExtra("open_chat", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    @Test fun automaticChatOmitsOldManualSelectionsAndExplicitOverridesRemainExact() {
        val auto = ChatRequest.body("Plan using Claude", "fixture-project", true, "retired-provider", "obsolete", "low", "Do a task", listOf("retired-provider"))
        assertEquals("auto", auto.getString("routing")); assertEquals("Plan using Claude", auto.getString("message"))
        assertEquals("fixture-project", auto.getString("projectId"))
        for (key in listOf("mode", "providerId", "model", "effort", "team")) assertFalse(auto.has(key))
        val manual = ChatRequest.body("Build", "fixture-project", false, "claude", "claude-opus-4-8", "max", "Build project files", emptyList())
        assertFalse(manual.has("routing")); assertEquals("build", manual.getString("mode")); assertEquals("claude-opus-4-8", manual.getString("model"))
        assertFalse(ChatRequest.body("Hello", "", true, "codex", "", "high", "Discuss", emptyList()).has("projectId"))
    }
    @Test fun quotaParserKeepsMissingInvalidAndUnavailableLimitsUnknown() {
        val payload = JSONObject("""{"providers":[{"id":"codex","status":"available","windows":[{"label":"Five-hour","usedPercent":25,"remainingPercent":75,"resetsAt":"2026-10-01T12:00:00Z"},{"usedPercent":"0","remainingPercent":100},{"usedPercent":150,"remainingPercent":-50},{"usedPercent":25,"remainingPercent":99}],"checkedAt":"invalid","detail":"Fixture"},{"id":"claude","status":"unavailable","windows":[{"usedPercent":0,"remainingPercent":100}]}]}""")
        val result = ProviderUsageModels.parse(payload)
        assertEquals(listOf("codex", "claude"), result.map { it.id }); assertEquals(1, result[0].windows.size)
        assertEquals(75.0, result[0].windows.single().remainingPercent, 0.0); assertNull(result[0].checkedAt)
        assertNotNull(result[0].windows.single().resetsAt)
        assertTrue(result[1].windows.isEmpty())
        assertTrue(ProviderUsageModels.parse(JSONObject()).all { it.status == "unavailable" && it.windows.isEmpty() })
    }
    @Test fun renderedChatStartsWithAutomaticChoiceAndVoiceEntryCannotBeExternallyLaunched() {
        val activity = activity()
        try {
            await("Automatic chat heading missing") { visible("Nakama chooses the AI") }
            assertFalse(visible("Model ID")); assertFalse(visible("Team mode")); assertTrue(visible("Talk"))
            val entry = instrumentation.targetContext.packageManager.getActivityInfo(ComponentName(instrumentation.targetContext, VoiceEntryActivity::class.java), 0)
            assertFalse("Other apps must not turn on the microphone with an exported activity", entry.exported)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun renderedUsageDoesNotAdoptDelayedReadAfterPermissionRemoval() {
        val activity = activity()
        val allowed = mutableStateOf(true)
        val pending = CompletableDeferred<JSONObject>()
        var calls = 0
        val identity = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ProviderUsagePanel(identity, true, allowed.value, { _, method, path, _ ->
                assertEquals("GET", method); assertEquals("/api/providers/usage", path); calls++; pending.await()
            }, {}) } } }
            await("Usage did not load on entry") { calls == 1 && visible("Checking your connected accounts") }
            instrumentation.runOnMainSync { allowed.value = false }
            await("Usage privacy notice missing") { visible("Usage is unavailable while Google access") }
            pending.complete(JSONObject("""{"providers":[{"id":"codex","status":"available","windows":[{"label":"PRIVATE FIXTURE","usedPercent":22,"remainingPercent":78}]}]}"""))
            instrumentation.waitForIdleSync()
            assertFalse(visible("PRIVATE FIXTURE")); assertFalse(visible("78% remaining")); assertEquals(1, calls)
        } finally { pending.cancel(); instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun renderedUsageShowsOnlyTheTwoSupportedAiAccounts() {
        val activity = activity()
        val identity = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ProviderUsagePanel(identity, true, true, { _, method, path, _ ->
                assertEquals("GET", method); assertEquals("/api/providers/usage", path)
                JSONObject("""{"providers":[{"id":"codex","status":"available","windows":[{"label":"Fixture allowance","usedPercent":22,"remainingPercent":78}]},{"id":"claude","status":"unavailable"},{"id":"retired-provider","name":"Removed account","status":"available","windows":[{"label":"PRIVATE REMOVED READING","usedPercent":0,"remainingPercent":100}]}]}""")
            }, {}) } } }
            await("Supported account cards missing") { visible("ChatGPT") && visible("Claude") && visible("78% remaining") }
            assertFalse(visible("Removed account")); assertFalse(visible("PRIVATE REMOVED READING"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun overlayStartsAfterReturningFromGrantedPermissionAndCanBeStoppedWithoutMicrophone() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        shell("cmd appops set dev.nakama.companion SYSTEM_ALERT_WINDOW deny")
        shell("pm grant dev.nakama.companion android.permission.POST_NOTIFICATIONS")
        val activity = activity()
        try {
            click("Home")
            click("Enable floating mascot")
            await("Overlay permission settings did not open") { nodes().firstOrNull()?.packageName?.toString() == "com.android.settings" }
            shell("cmd appops set dev.nakama.companion SYSTEM_ALERT_WINDOW allow")
            assertTrue(Settings.canDrawOverlays(instrumentation.targetContext))
            instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            await("Mascot did not start automatically after permission return") { MascotOverlayService.running }
            assertTrue("The enabled service should have no error", MascotOverlayService.lastError.isBlank())
            // No tap on the floating view: the real microphone is never opened by this test.
            click("Hide mascot & stop control")
            await("Mascot did not stop") { !MascotOverlayService.running }
        } finally {
            instrumentation.targetContext.stopService(Intent(instrumentation.targetContext, MascotOverlayService::class.java))
            shell("cmd appops set dev.nakama.companion SYSTEM_ALERT_WINDOW deny")
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
