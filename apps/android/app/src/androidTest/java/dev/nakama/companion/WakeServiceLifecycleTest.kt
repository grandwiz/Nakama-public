package dev.nakama.companion

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real service/activity/notification lifecycle, synthetic callbacks only; never opens a microphone. */
@RunWith(AndroidJUnit4::class)
class WakeServiceLifecycleTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun main(block: () -> Unit) = instrumentation.runOnMainSync(block)
    private fun await(message: String, predicate: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) {
            var accepted = false
            main { accepted = predicate() }
            if (accepted) return
            SystemClock.sleep(80)
        }
        fail(message)
    }
    private class FakeRecognition(private val result: (String) -> Unit) : VoiceRecognition {
        override val continuousSession = true
        var started = false; var closed = false
        private var ready: () -> Unit = {}
        override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) { ready = onReady }
        override fun start() { check(!closed); started = true; ready() }
        override fun close() { closed = true }
        fun completed(text: String) = result(text)
    }

    @Test fun visibleStartSurvivesHomeAndTaskRemovalUntilExplicitNotificationStop() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        val context = instrumentation.targetContext
        check(PairingVault(context).load() == null) { "Lifecycle fixture requires an unpaired disposable installation." }
        check(!context.getSystemService(KeyguardManager::class.java).isDeviceLocked) { "Unlock the disposable emulator before the lifecycle fixture." }
        main { check(!WakeWordService.running) { "Do not replace an existing wake session." } }
        val prefs = context.getSharedPreferences("nakama_preferences", Context.MODE_PRIVATE)
        val hadPreference = prefs.contains("wakeEnabled")
        val previousPreference = prefs.getBoolean("wakeEnabled", false)
        check(!previousPreference) { "Do not replace an existing wake opt-in." }
        val permissions = listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
        val previouslyGranted = permissions.associateWith { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
        var activity: MainActivity? = null
        val inputs = mutableListOf<FakeRecognition>()
        try {
            prefs.edit().putBoolean("wakeEnabled", false).commit()
            permissions.filter { previouslyGranted[it] != true }.forEach { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it) }
            main {
                check(WakeWordService.recognitionFactoryForTest == null) { "Another fixture already owns recognition." }
                WakeWordService.recognitionFactoryForTest = { result, _ -> FakeRecognition(result).also(inputs::add) }
            }
            activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val visible = checkNotNull(activity)
            await("Activity was not visible before microphone foreground-service start") {
                ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(visible) == Stage.RESUMED && visible.hasWindowFocus()
            }
            main {
                prefs.edit().putBoolean("wakeEnabled", true).commit()
                // A saved opt-in must support the ordinary action-less startup path.
                ContextCompat.startForegroundService(visible, Intent(visible, WakeWordService::class.java))
            }
            val notifications = context.getSystemService(NotificationManager::class.java)
            await("Synthetic wake microphone did not become ready") {
                WakeWordService.running && inputs.singleOrNull()?.started == true && WakeWordService.status.contains("Microphone ready")
            }
            assertTrue("Wake must publish a real foreground-service notification", notifications.activeNotifications.any {
                it.id == 72 && it.notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0
            })
            assertTrue(instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME))
            await("Home did not background the activity or release foreground audio ownership") {
                ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(visible) == Stage.STOPPED &&
                    WakeWordService.foregroundCommand == null && !VoiceAudioGate.busy
            }
            main {
                assertTrue(WakeWordService.running)
                assertFalse(inputs.single().closed)
                inputs.single().completed("unrelated synthetic background words")
            }
            await("Background service stopped processing recognition callbacks") {
                WakeWordService.status.contains("continuous local wake listening") && inputs.size == 1
            }
            assertTrue(instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN))
            SystemClock.sleep(700)
            main { assertTrue("Lock must keep the opted-in listener active", WakeWordService.running); assertFalse(inputs.single().closed); inputs.single().completed("unrelated locked synthetic words") }
            await("Locked listener stopped reporting readiness") { WakeWordService.status.contains("continuous local wake listening") }
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_WAKEUP").close()
            instrumentation.uiAutomation.executeShellCommand("wm dismiss-keyguard").close()
            main { visible.finishAndRemoveTask() }
            await("Task removal did not destroy its activity") {
                ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(visible) == Stage.DESTROYED
            }
            main {
                assertTrue("Removing Recents task must not stop the opted-in service", WakeWordService.running)
                assertFalse(inputs.single().closed)
                inputs.single().completed("Hey Nakama") // No command is submitted, no host or playback is used.
            }
            await("Wake stopped responding after task removal") { WakeWordService.status.contains("say your command") }
            val notification = notifications.activeNotifications.single { it.id == 72 }.notification
            val stop = notification.actions.single { it.title.toString() == "Stop listening" }
            stop.actionIntent.send()
            await("Notification Stop did not release the synthetic listener") {
                !WakeWordService.running && inputs.single().closed && notifications.activeNotifications.none { it.id == 72 }
            }
            main {
                assertFalse(prefs.getBoolean("wakeEnabled", true))
                inputs.single().completed("Hey Nakama stale command must not run")
                assertFalse(WakeWordService.running)
                assertEquals("Off", WakeWordService.status)
                assertFalse(VoiceAudioGate.busy)
            }
        } finally {
            prefs.edit().putBoolean("wakeEnabled", false).commit()
            main { context.stopService(Intent(context, WakeWordService::class.java)); activity?.finish() }
            await("Fixture service failed to stop") { !WakeWordService.running && inputs.all { it.closed } }
            main { WakeWordService.recognitionFactoryForTest = null }
            if (hadPreference) prefs.edit().putBoolean("wakeEnabled", previousPreference).commit() else prefs.edit().remove("wakeEnabled").commit()
            // Grants belong to this disposable installation. Revoking them while instrumentation
            // runs would kill its target process; emulator teardown discards the permissions.
        }
    }
}
