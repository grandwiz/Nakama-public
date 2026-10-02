package dev.nakama.companion

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

private class FixtureTimerStore : LocalTimerStorage {
    var timers = emptyList<LocalTimer>()
    override fun load() = timers.toList()
    override fun save(timers: List<LocalTimer>) { this.timers = timers.toList() }
}
private class FixtureTimerEffects : LocalTimerEffects {
    var scheduled = 0
    var finished = 0
    override fun unavailable(): String? = null
    override fun schedule(timer: LocalTimer, remainingMillis: Long) { scheduled++ }
    override fun cancel(timer: LocalTimer) = Unit
    override fun notifyFinished(timer: LocalTimer) { finished++ }
    override fun silence(timer: LocalTimer) = Unit
}

/** Emulator-only UI and persistence; all alarm/notification effects are synthetic. */
@RunWith(AndroidJUnit4::class)
class ClockPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun emulatorOnly() { check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." } }
    private fun nodes(): List<AccessibilityNodeInfo> {
        val queue = ArrayDeque<AccessibilityNodeInfo>(); val found = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(queue::add)
        while (queue.isNotEmpty() && found.size < 500) {
            val node = queue.removeFirst(); found += node
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return found
    }
    private fun button(label: String): AccessibilityNodeInfo? {
        var node = nodes().firstOrNull { it.text?.toString() == label }
        repeat(5) { if (node?.isClickable == true) return node; node = node?.parent }
        return null
    }
    private fun await(message: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < deadline) { if (condition()) return; SystemClock.sleep(60) }
        fail(message)
    }
    private fun reveal(label: String) {
        // Engine writes precede Compose/accessibility frames. Wait at the current position first,
        // then search both directions so a relayout cannot strand a control above the viewport.
        repeat(8) {
            instrumentation.waitForIdleSync()
            if (button(label) != null) return
            SystemClock.sleep(100)
        }
        fun scroll(action: Int): Boolean {
            val scrollable = nodes().firstOrNull { node ->
                node.isScrollable && node.actionList.any { it.id == AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id }
            } ?: nodes().firstOrNull { it.isScrollable }
            val moved = scrollable?.performAction(action) == true
            SystemClock.sleep(180)
            instrumentation.waitForIdleSync()
            return moved
        }
        repeat(12) {
            if (button(label) != null) return
            scroll(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        }
        repeat(16) {
            if (button(label) != null) return
            scroll(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        }
        fail("Missing button: $label")
    }
    @Test fun localTimerCanStartPauseResumeAndCancelWithoutHostOrRealAlarms() {
        emulatorOnly()
        val store = FixtureTimerStore(); val effects = FixtureTimerEffects()
        val now = TimerMoment(1_800_000_000_000, 1000, 1)
        val engine = LocalTimerEngine(store, effects, { now }, { "fixture-timer" })
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ClockPanel({ fail("No permission action expected") }, engine, { now }) } } }
            await("Clock did not load") { nodes().any { it.text?.toString() == "This phone · works offline" } }
            reveal("Start phone timer")
            button("Start phone timer")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Synthetic timer was not created") { store.timers.singleOrNull()?.status == "running" }
            assertEquals(600_000, store.timers.single().durationMillis)
            reveal("Pause"); button("Pause")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Timer was not paused") { store.timers.single().status == "paused" }
            reveal("Resume"); button("Resume")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Timer was not resumed") { store.timers.single().status == "running" }
            reveal("Cancel timer"); button("Cancel timer")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            await("Timer was not cancelled") { store.timers.single().status == "cancelled" }
            assertEquals(2, effects.scheduled)
            assertEquals(0, effects.finished)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun timeAndGreetingNeedNoPairingNetworkOrTimerPreferences() {
        emulatorOnly()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("nakama_local_timers", Context.MODE_PRIVATE)
        val before = preferences.all.toMap()
        val started = SystemClock.elapsedRealtime()
        val time = LocalClockActions.execute(context, LocalClockCommands.parse("what time is it")!!)
        val greeting = LocalClockActions.execute(context, LocalClockCommands.parse("hello")!!)
        assertTrue(time.text.startsWith("It's "))
        assertTrue(greeting.text.startsWith("Hello!"))
        assertFalse(time.openClock); assertFalse(greeting.openClock)
        assertEquals(before, preferences.all)
        assertTrue("A local clock reply should not wait for the host", SystemClock.elapsedRealtime() - started < 1000)
    }
    @Test fun persistedPhoneTimerRestoresDeadlineWithSyntheticEffects() {
        emulatorOnly()
        val context = instrumentation.targetContext
        val preferenceName = "nakama_clock_test_fixture_" + java.util.UUID.randomUUID().toString()
        val preferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
        check(preferences.edit().clear().commit())
        try {
            var now = TimerMoment(1_000_000, 100_000, 1)
            val effects = FixtureTimerEffects()
            val engine = LocalTimerEngine(AndroidLocalTimerStorage(context, preferenceName), effects, { now }, { "fixture" })
            engine.create(60, "Fixture tea")
            now = TimerMoment(1_030_000, 1000, 2)
            val reloaded = LocalTimerEngine(AndroidLocalTimerStorage(context, preferenceName), effects, { now }, { "unused" })
            reloaded.restore()
            assertEquals(30_000, reloaded.snapshot().single().remainingMillis)
            assertEquals(31_000, reloaded.snapshot().single().elapsedEnd)
            now = TimerMoment(1_060_000, 31_000, 2)
            val current = reloaded.snapshot().single()
            assertTrue(reloaded.fire(current.id, current.revision))
            assertFalse(reloaded.fire(current.id, current.revision))
            assertEquals(1, effects.finished)
        } finally { check(preferences.edit().clear().commit()) }
    }
}
