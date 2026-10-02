package dev.nakama.companion

import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** UI-only app choices in an unpaired disposable emulator; no app is launched or controlled. */
@RunWith(AndroidJUnit4::class)
class InstalledAppPickerTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && result.size < 600) {
            val node = queue.removeFirst(); result += node
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }
        fail(message)
    }
    private fun click(text: String, scrollMenu: Boolean = false) {
        // Accessibility exposes only the visible rows in Compose's bounded dropdown.
        // Scroll the popup itself so this also verifies choosing an app below the fold.
        await("Missing choice: $text") {
            val current = nodes()
            if (current.any { it.text?.toString() == text }) true
            else {
                if (scrollMenu) current.lastOrNull { it.isScrollable && it.actionList.any { action -> action.id == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD } }
                    ?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                false
            }
        }
        var node = nodes().first { it.text?.toString() == text }
        repeat(6) { if (node.isClickable) { assertTrue(node.performAction(AccessibilityNodeInfo.ACTION_CLICK)); return }; node = node.parent ?: return@repeat }
        fail("Choice is not clickable: $text")
    }
    @Test fun realLauncherAppShowsNameAndReturnsExactPackage() {
        val activity = activity()
        val apps = InstalledApps.launchable(instrumentation.targetContext)
        val own = apps.first { it.packageName == "dev.nakama.companion" }
        val expectedLabel = InstalledAppPolicy.choiceLabel(own, apps)
        val selected = mutableStateOf("")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Column {
                InstalledAppPicker("Installed app", selected.value, onSelected = { selected.value = it })
                Text("Selected: ${selected.value}")
            } } } }
            click("Choose an installed app")
            click(expectedLabel, scrollMenu = true)
            await("App name did not keep its exact package") { selected.value == own.packageName }
            await("Selected app name is missing") { nodes().any { it.text?.toString() == expectedLabel } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun controlPickerDisambiguatesNamesAndOmitsProtectedApps() {
        val activity = activity()
        val selected = mutableStateOf("")
        val fixture = listOf(InstalledApp("com.fixture.first", "Reader"), InstalledApp("com.fixture.second", "Reader"),
            InstalledApp("dev.nakama.companion", "Nakama"), InstalledApp("com.android.settings", "Settings"),
            InstalledApp("com.google.android.permissioncontroller", "Permissions"))
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Column {
                InstalledAppPicker("Control app", selected.value, controlOnly = true, appSource = { fixture }, onSelected = { selected.value = it })
                Text("Selected: ${selected.value}")
            } } } }
            click("Choose an installed app")
            await("Duplicate display names were not disambiguated") { nodes().any { it.text?.toString() == "Reader (com.fixture.first)" } && nodes().any { it.text?.toString() == "Reader (com.fixture.second)" } }
            assertFalse(nodes().any { it.text?.toString() in listOf("Settings", "Permissions", "Nakama") })
            click("Reader (com.fixture.second)")
            await("Wrong exact package selected") { selected.value == "com.fixture.second" }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
