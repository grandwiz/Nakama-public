package dev.nakama.companion

import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReplyWaitingPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun visible(value: String): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        var count = 0
        while (queue.isNotEmpty() && count++ < 1_000) {
            val node = queue.removeFirst()
            if (node.isVisibleToUser && node.text?.toString()?.contains(value) == true) return true
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add)
        }
        return false
    }
    private fun await(message: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 8_000
        while (SystemClock.uptimeMillis() < deadline) { if (condition()) return; SystemClock.sleep(60) }
        fail(message)
    }

    @Test fun waitingPanelShowsActualPhaseElapsedTimeAndNoPrematureSlowWarning() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        PairingVault(instrumentation.targetContext).clear()
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val elapsed = mutableStateOf(3_000L)
        val phase = mutableStateOf("checking_account")
        val effort = mutableStateOf("low")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ReplyWaitingPanel("ChatGPT", effort.value, elapsed.value, phase.value) } } }
            await("Account check feedback missing") { visible("Checking your AI account · 3s") }
            assertFalse(visible("can take longer")); assertFalse(visible("still waiting"))
            instrumentation.runOnMainSync { elapsed.value = 65_000; phase.value = "starting_model"; effort.value = "ultra" }
            await("Provider phase or elapsed duration missing") { visible("Waiting for ChatGPT · 1m 5s") && visible("Higher thinking effort can take longer") }
            instrumentation.runOnMainSync { phase.value = "answering"; effort.value = "low" }
            await("Completed-item feedback missing") { visible("Finishing your reply · 1m 5s") && visible("Your PC is still waiting") }
            assertFalse(visible("Higher thinking effort can take longer"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
