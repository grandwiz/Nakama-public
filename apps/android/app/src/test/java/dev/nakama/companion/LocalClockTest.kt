package dev.nakama.companion

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class LocalClockCommandsTest {
    @Test fun greetingsTimeAndDateAreExactLocalRequests() {
        for (text in listOf("Hello", "Hi Nakama!", "Hey Nakama, hello", "how are you?")) assertEquals(text, LocalClockCommand.Greeting, LocalClockCommands.parse(text))
        for (text in listOf("what time is it", "what's the time?", "Nakama, tell me the time please.")) assertEquals(text, LocalClockCommand.Time, LocalClockCommands.parse(text))
        assertEquals("It's 11:05 am.", LocalClockCommands.immediate(LocalClockCommand.Time, Instant.parse("2026-10-02T10:05:00Z"), ZoneId.of("Europe/London")))
        assertEquals("It's Friday, 2 October 2026.", LocalClockCommands.immediate(LocalClockCommand.Date, Instant.parse("2026-10-02T10:05:00Z"), ZoneId.of("Europe/London")))
    }
    @Test fun spokenAndNumericDurationsHaveIdenticalBoundedMeaning() {
        val samples = mapOf(
            "set a 10 minute timer" to 600L, "start a ten-minute timer" to 600L,
            "set a timer for ten minutes" to 600L, "set a 1 hour and thirty minute timer" to 5400L,
            "start a half an hour timer" to 1800L, "set a quarter of an hour timer" to 900L,
            "set a twenty-one second timer" to 21L, "set a one hundred twenty minute timer" to 7200L,
            "set a 0.5 minute timer" to 30L,
        )
        samples.forEach { (text, seconds) -> assertEquals(text, LocalClockCommand.CreateTimer(seconds), LocalClockCommands.parse(text)) }
        assertEquals(LocalClockCommand.CreateTimer(600, "eggs"), LocalClockCommands.parse("set a ten minute timer called eggs"))
        assertEquals(LocalClockCommand.CreateTimer(90, "tea"), LocalClockCommands.parse("start a timer for 90 seconds named tea"))
    }
    @Test fun malformedNegativeAndNonFiniteDurationsNeverStartTimers() {
        for (duration in listOf("-1 minute", "+1 minute", "-ten minutes", "zero seconds", "1.1 seconds", "NaN hours", "infinity minutes", "1e999 seconds", "169 hours", "ten minutes garbage", "ten minutes and")) {
            assertNull(duration, LocalClockCommands.durationSeconds(duration.lowercase()))
            val command = LocalClockCommands.parse("set a $duration timer")
            assertFalse(duration, command is LocalClockCommand.CreateTimer)
        }
        assertEquals(604800L, LocalClockCommands.durationSeconds("168 hours"))
    }
    @Test fun controlsNamesAndClockNavigationAreLocal() {
        assertEquals(LocalClockCommand.ChangeTimer("pause"), LocalClockCommands.parse("pause my timer"))
        assertEquals(LocalClockCommand.ChangeTimer("resume", "tea"), LocalClockCommands.parse("resume the tea timer"))
        assertEquals(LocalClockCommand.ChangeTimer("dismiss"), LocalClockCommands.parse("dismiss timer"))
        assertEquals(LocalClockCommand.ListTimers("eggs"), LocalClockCommands.parse("how much time is left on the eggs timer"))
        assertEquals(LocalClockCommand.Open, LocalClockCommands.parse("open clock"))
        assertEquals(NakamaNavigation.Page("Tools", "Clock"), NavigationPolicy.hostTarget("clock"))
    }
    @Test fun quotedNegatedAndCompoundRequestsNeverPartlyExecute() {
        for (text in listOf("don't set a ten minute timer", "explain how to set a ten minute timer", "'set a ten minute timer'", "hello and send a message", "what time is it and set a timer", "pause timer and resume the tea timer")) {
            assertNull(text, LocalClockCommands.parse(text))
        }
        for (action in listOf("resume", "dismiss", "create", "pause", "stop", "cancel", "open", "send", "call", "set", "start")) {
            val command = LocalClockCommands.parse("set a ten minute timer called eggs and $action the tea timer")
            assertFalse(action, command is LocalClockCommand.CreateTimer)
        }
        assertFalse(LocalClockCommands.parse("set a ten minute timer named eggs don't start it") is LocalClockCommand.CreateTimer)
    }
}

private class MemoryTimers : LocalTimerStorage {
    var values = emptyList<LocalTimer>()
    override fun load() = values.toList()
    override fun save(timers: List<LocalTimer>) { values = timers.toList() }
}
private class FakeTimerEffects : LocalTimerEffects {
    var permission: String? = null
    var scheduleFails = false
    var notifyFails = false
    val registered = mutableMapOf<String, LocalTimer>()
    val notified = mutableListOf<LocalTimer>()
    val silenced = mutableListOf<String>()
    override fun unavailable() = permission
    override fun schedule(timer: LocalTimer, remainingMillis: Long) {
        registered[timer.id] = timer
        if (scheduleFails) error("Synthetic registration failure")
    }
    override fun cancel(timer: LocalTimer) { registered.remove(timer.id) }
    override fun notifyFinished(timer: LocalTimer) { if (notifyFails) error("Synthetic alert failure") else notified += timer }
    override fun silence(timer: LocalTimer) { silenced += timer.id }
}
class LocalTimerPolicyTest {
    @Test fun timerPauseResumeAndStaleReceiversKeepOneDeadlineAndOneAlert() {
        val store = MemoryTimers(); val effects = FakeTimerEffects()
        var now = TimerMoment(1_000_000, 1000, 1)
        val engine = LocalTimerEngine(store, effects, { now }, { "tea" })
        val timer = engine.create(10, "Tea")
        assertEquals("running", timer.status); assertEquals(1_010_000, timer.endsAt); assertEquals(11_000, timer.elapsedEnd)
        now = TimerMoment(1_002_500, 3500, 1)
        val paused = engine.change(timer.id, timer.revision, "pause")
        assertEquals(7500, paused.remainingMillis); assertTrue(effects.registered.isEmpty())
        now = TimerMoment(1_100_000, 100_000, 1)
        val resumed = engine.change(paused.id, paused.revision, "resume")
        assertEquals(107_500, resumed.elapsedEnd)
        assertFalse(engine.fire(timer.id, timer.revision))
        now = TimerMoment(1_107_500, 107_500, 1)
        assertTrue(engine.fire(resumed.id, resumed.revision))
        assertFalse(engine.fire(resumed.id, resumed.revision))
        assertEquals(1, effects.notified.size)
        val finished = engine.snapshot().single()
        assertEquals("dismissed", engine.change(finished.id, finished.revision, "dismiss").status)
    }
    @Test fun missingPermissionSavesPausedAndOnlyExplicitResumeSchedules() {
        val store = MemoryTimers(); val effects = FakeTimerEffects().apply { permission = "Allow exact alarms." }
        val engine = LocalTimerEngine(store, effects, { TimerMoment(1000, 1000, 1) }, { "timer" })
        val timer = engine.create(600)
        assertEquals("paused", timer.status); assertEquals(600_000, timer.remainingMillis); assertEquals("Allow exact alarms.", timer.issue)
        effects.permission = null
        engine.restore()
        assertTrue(effects.registered.isEmpty())
        val resumed = engine.change(timer.id, timer.revision, "resume")
        assertEquals("running", resumed.status); assertEquals(1, effects.registered.size)
    }
    @Test fun partialRegistrationFailureRollsBackAndSilencesTheCountdown() {
        val store = MemoryTimers(); val effects = FakeTimerEffects().apply { scheduleFails = true }
        val engine = LocalTimerEngine(store, effects, { TimerMoment(1000, 1000, 1) }, { "timer" })
        val timer = engine.create(60)
        assertEquals("paused", timer.status); assertTrue(timer.issue.contains("failure"))
        assertTrue(effects.registered.isEmpty()); assertTrue("timer" in effects.silenced)
    }
    @Test fun rebootUsesPersistedWallDeadlineWhileClockChangesUseMonotonicTime() {
        val store = MemoryTimers(); val effects = FakeTimerEffects()
        var now = TimerMoment(1_000_000, 100_000, 7)
        val engine = LocalTimerEngine(store, effects, { now }, { "timer" })
        val timer = engine.create(60)
        now = TimerMoment(4_605_000, 105_000, 7)
        assertEquals(55_000, LocalTimerPolicy.remaining(timer, now))
        engine.restore()
        val adjusted = engine.snapshot().single()
        assertEquals(4_660_000, adjusted.endsAt)
        now = TimerMoment(4_630_000, 1000, 8)
        engine.restore()
        val rebooted = engine.snapshot().single()
        assertEquals(30_000, rebooted.remainingMillis); assertEquals(31_000, rebooted.elapsedEnd)
        now = TimerMoment(4_670_000, 2000, 9)
        engine.restore(); engine.restore()
        assertEquals("finished", engine.snapshot().single().status)
        assertEquals(1, effects.notified.size)
    }
    @Test fun revokedPermissionsDuringRestoreRemoveOldCountdownAndStayPaused() {
        val store = MemoryTimers(); val effects = FakeTimerEffects()
        val engine = LocalTimerEngine(store, effects, { TimerMoment(1000, 1000, 1) }, { "timer" })
        engine.create(60)
        effects.permission = "Notifications are off."
        engine.restore()
        assertEquals("paused", engine.snapshot().single().status)
        assertTrue(effects.registered.isEmpty()); assertTrue("timer" in effects.silenced)
    }
    @Test fun stalePauseOrCancelCannotChangeAResumedTimer() {
        val store = MemoryTimers(); val effects = FakeTimerEffects()
        val engine = LocalTimerEngine(store, effects, { TimerMoment(1000, 1000, 1) }, { "timer" })
        val original = engine.create(60)
        val paused = engine.change(original.id, original.revision, "pause")
        val resumed = engine.change(paused.id, paused.revision, "resume")
        assertThrows(IllegalStateException::class.java) { engine.change(original.id, original.revision, "cancel") }
        assertEquals(resumed, engine.snapshot().single())
    }
    @Test fun retentionNeverHidesNewTimersAfterManyCompletions() {
        val store = MemoryTimers(); val effects = FakeTimerEffects()
        var now = TimerMoment(1000, 1000, 1); var sequence = 0
        val engine = LocalTimerEngine(store, effects, { now }, { "timer-${++sequence}" })
        repeat(150) {
            val timer = engine.create(1)
            now = TimerMoment(now.wallMillis + 1000, now.elapsedMillis + 1000, 1)
            assertTrue(engine.fire(timer.id, timer.revision))
        }
        assertEquals(40, engine.snapshot().size)
        val latest = engine.create(10)
        assertTrue(engine.snapshot().any { it.id == latest.id })
        assertTrue(engine.snapshot().size < 128)
        assertTrue(effects.silenced.size >= 110)
    }
    @Test fun boundsAndAlertFailureNeverBecomeFalseSuccess() {
        val store = MemoryTimers(); val effects = FakeTimerEffects().apply { notifyFails = true }
        var now = TimerMoment(1000, 1000, 1)
        val engine = LocalTimerEngine(store, effects, { now }, { "timer" })
        assertThrows(IllegalArgumentException::class.java) { engine.create(0) }
        assertThrows(IllegalArgumentException::class.java) { engine.create(604_801) }
        val timer = engine.create(1)
        now = TimerMoment(2000, 2000, 1)
        engine.fire(timer.id, timer.revision)
        assertEquals("finished", engine.snapshot().single().status)
        assertTrue(engine.snapshot().single().issue.contains("alert failure"))
    }
}
