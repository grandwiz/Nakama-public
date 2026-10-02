package dev.nakama.companion

import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VoiceSettingsPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun await(message: String, predicate: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) { if (predicate()) return; SystemClock.sleep(100) }
        fail(message)
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return emptyList()
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val found = mutableListOf<AccessibilityNodeInfo>(); queue.add(root)
        while (queue.isNotEmpty() && found.size < 1000) {
            val node = queue.removeFirst(); found.add(node)
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return found
    }
    private fun visible(text: String) = nodes().any { it.isVisibleToUser && (it.text?.toString()?.contains(text) == true || it.contentDescription?.toString()?.contains(text) == true) }
    private fun click(text: String) {
        await("Expected clickable control: $text") {
            var node = nodes().firstOrNull { it.isVisibleToUser && (it.text?.toString() == text || it.contentDescription?.toString() == text) }
            repeat(8) {
                if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node = node?.parent
            }; false
        }
    }
    private fun show(services: FakeVoiceServices, store: MemoryVoicePreferences): Pair<MainActivity, VoiceController> {
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        lateinit var controller: VoiceController
        instrumentation.runOnMainSync {
            controller = VoiceController(services, store, {}, {})
            activity.setContent { MaterialTheme { Surface(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) { VoiceSettingsPanel(controller, {}, {}) } } }
        }
        await("Voice panel did not render") { visible("Your British English voice") }
        return activity to controller
    }

    @Test fun renderedChoiceDoesNotPlayUntilExplicitPreviewAndShowsNetworkTraits() {
        val services = FakeVoiceServices(); val store = MemoryVoicePreferences()
        val (activity, controller) = show(services, store)
        try {
            click("British local A")
            await("Missing internet trait") { visible("Internet needed") }
            click("British local B")
            await("Voice choice was not saved") { store.value.voice == "British local B" }
            assertTrue("Choosing a voice must not play audio", services.output.spoken.isEmpty())
            click("Slower")
            click("Preview voice")
            await("Explicit preview did not reach fake output") { services.output.spoken.size == 1 }
            assertEquals(0.85f, store.value.rate, 0f)
            click("Stop voice")
            assertTrue(services.requests.isEmpty())
        } finally { instrumentation.runOnMainSync { controller.close(); activity.finish() } }
    }

    @Test fun renderedUnavailableStateExplainsOfflineSetupAndDisablesPreview() {
        val services = FakeVoiceServices().apply { onDevice = false; output.available = output.available.filter { it.needsNetwork } }
        val (activity, controller) = show(services, MemoryVoicePreferences())
        try {
            await("Missing offline setup instructions") { visible("No usable offline British English voice") }
            assertTrue(visible("Android speech settings"))
            var preview = nodes().firstOrNull { it.text?.toString() == "Preview voice" }
            repeat(6) { if (preview?.isClickable != true) preview = preview?.parent }
            assertNotNull(preview)
            assertFalse("Preview cannot be used without an offline voice", preview!!.isEnabled)
            assertTrue(services.output.spoken.isEmpty())
            assertEquals(RecognitionMode.NEEDS_OPT_IN, controller.recognitionMode)
        } finally { instrumentation.runOnMainSync { controller.close(); activity.finish() } }
    }
}
