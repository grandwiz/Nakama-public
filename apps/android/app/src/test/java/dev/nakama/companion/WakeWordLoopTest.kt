package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class WakeWordLoopTest {
    private class Fake(override val continuousSession: Boolean = false, override val startupTimeoutMillis: Long = 8_000L) : VoiceRecognition {
        lateinit var result: (String) -> Unit
        lateinit var error: (Int) -> Unit
        var started = false; var closed = false
        var ready: () -> Unit = {}; var ended: () -> Unit = {}; var partial: (String) -> Unit = {}
        override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) { ready = onReady; ended = onEnd; partial = onPartial }
        override fun start() { started = true }
        override fun close() { closed = true }
    }
    @Test fun onlyWakeAndFollowingCommandAreDeliveredAndOldCallbacksStayStopped() {
        var now = 0L
        val created = mutableListOf<Fake>(); val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, failure -> Fake().also { it.result = result; it.error = failure; created += it } }, {}, commands::add)
        loop.start(); loop.tick(false); assertTrue(created.single().started)
        created.last().result("An incidental mention of Nakama")
        assertTrue(commands.isEmpty())
        now += 1000; loop.tick(false); created.last().result("Nakama")
        assertTrue(commands.isEmpty())
        now += 500; loop.tick(false); val active = created.last(); active.result("show my tasks")
        assertEquals(listOf("show my tasks"), commands)
        active.result("duplicate command"); assertEquals(1, commands.size)
        now += 6000; loop.tick(false); val stale = created.last(); loop.stop(); stale.result("Nakama send something")
        assertFalse(loop.enabled); assertEquals(1, commands.size); assertTrue(stale.closed)
    }
    @Test fun conversationAndTtsPauseCaptureAndInvalidateResults() {
        var now = 10L
        val created = mutableListOf<Fake>(); val commands = mutableListOf<String>(); var status = ""
        val loop = WakeWordLoop({ now }, { result, failure -> Fake().also { it.result = result; it.error = failure; created += it } }, { status = it }, commands::add)
        loop.start(); loop.tick(false); val earlier = created.single()
        loop.tick(true); assertTrue(earlier.closed); assertTrue(status.startsWith("Paused"))
        earlier.result("Nakama unintended echo"); assertTrue(commands.isEmpty())
        now += 1000; loop.tick(false); assertEquals(2, created.size)
        created.last().result("Nakama open routines"); assertEquals(listOf("open routines"), commands)
    }
    @Test fun timeoutRetriesLocallyButOtherErrorsPauseWithoutFallback() {
        var now = 1L
        val created = mutableListOf<Fake>(); var status = ""
        val loop = WakeWordLoop({ now }, { result, failure -> Fake().also { it.result = result; it.error = failure; created += it } }, { status = it }, {})
        loop.start(); loop.tick(false); created.single().error(6)
        assertTrue(loop.enabled); now += 1001; loop.tick(false); assertEquals(2, created.size)
        created.last().error(2); assertFalse(loop.enabled); assertTrue(status.startsWith("Paused"))
        now += 20_000; loop.tick(false); assertEquals(2, created.size)
    }
    @Test fun recognizerContentionRetriesLocallyButStopsAfterBoundedAttempts() {
        var now = 1L; val created = mutableListOf<Fake>()
        val loop = WakeWordLoop({ now }, { result, error -> Fake().also { it.result = result; it.error = error; created += it } }, {}, {})
        loop.start()
        repeat(4) { loop.tick(false); created.last().error(8); now += 4_000 }
        assertFalse(loop.enabled); assertEquals(4, created.size)
    }
    @Test fun staleWakeHandoffsCannotExecuteAfterLongDelayOrClockReset() {
        assertTrue(WakeCommandPolicy.fresh(1_000, 31_000))
        assertFalse(WakeCommandPolicy.fresh(1_000, 31_001))
        assertFalse(WakeCommandPolicy.fresh(1_000, 999))
        assertFalse(WakeCommandPolicy.fresh(0, 500))
    }

    @Test fun readinessIsNotClaimedUntilAndroidCallbackAndPartialWordsNeverSubmit() {
        var now = 1L; lateinit var input: Fake; var status = ""; val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, error -> Fake(true).also { it.result = result; it.error = error; input = it } }, { status = it }, commands::add)
        loop.start(); loop.tick(false)
        assertTrue(status.startsWith("Starting")); assertFalse(status.contains("Microphone ready"))
        input.ready(); assertTrue(status.startsWith("Microphone ready"))
        input.partial("Nakama send a message")
        assertTrue(status.startsWith("Wake phrase heard")); assertTrue(commands.isEmpty())
        input.result("Nakama what time is it")
        assertEquals(listOf("what time is it"), commands); assertTrue(input.closed)
        input.partial("Nakama stale"); input.result("Nakama duplicate")
        assertEquals(1, commands.size)
    }
    @Test fun continuousIdleAndSegmentsDoNotRestartTheRecognizerOrItsChime() {
        var now = 1L; val created = mutableListOf<Fake>(); val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, error -> Fake(true).also { it.result = result; it.error = error; created += it } }, {}, commands::add)
        loop.start(); loop.tick(false); created.single().ready()
        repeat(60) { now += 1_000; loop.tick(false) }
        created.single().result("unrelated background speech")
        created.single().result("Nakama")
        assertTrue(commands.isEmpty()); assertEquals(1, created.size); assertFalse(created.single().closed)
        created.single().result("what time is it")
        assertEquals(listOf("what time is it"), commands); assertTrue(created.single().closed)
    }
    @Test fun unsupportedContinuousSessionsStopInsteadOfGeneratingRepeatedStartSounds() {
        for (terminal in listOf(-100, 6, 7)) {
            var now = 1L; val created = mutableListOf<Fake>(); var status = ""
            val loop = WakeWordLoop({ now }, { result, error -> Fake(true).also { it.result = result; it.error = error; created += it } }, { status = it }, {})
            loop.start(); loop.tick(false); created.single().ready(); created.single().error(terminal)
            repeat(20) { now += 10_000; loop.tick(false) }
            assertFalse(loop.enabled); assertEquals(1, created.size); assertTrue(status.contains("unsupported")); assertTrue(created.single().closed)
        }
    }
    @Test fun stoppedOrStalledCaptureCannotContinueUsingTheMicrophone() {
        var now = 1L; val created = mutableListOf<Fake>(); var status = ""
        val loop = WakeWordLoop({ now }, { result, error -> Fake(true).also { it.result = result; it.error = error; created += it } }, { status = it }, {})
        loop.start()
        repeat(3) { loop.tick(false); now += 8_001; loop.tick(false); now += 301 }
        assertFalse(loop.enabled); assertEquals(3, created.size); assertTrue(created.all { it.closed }); assertTrue(status.contains("never reported microphone ready"))
        loop.start(); loop.tick(false); val active = created.last(); active.ready(); active.ended(); now += 6_001; loop.tick(false)
        assertFalse(loop.enabled); assertTrue(active.closed); assertTrue(status.contains("no continuous recognition result"))
    }

    @Test fun bundledPreparationGetsBoundedTimeWithoutPrematureReadyAndStopInvalidatesIt() {
        var now = 1L; val created = mutableListOf<Fake>(); var status = ""; val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, error -> Fake(true, 60_000L).also { it.result = result; it.error = error; created += it } }, { status = it }, commands::add)
        loop.start(); loop.tick(false)
        now += 15_000; loop.tick(false)
        assertEquals(1, created.size); assertFalse(created.single().closed)
        assertTrue(status.startsWith("Starting")); assertFalse(status.contains("Microphone ready"))
        val preparing = created.single(); loop.stop(); preparing.ready(); preparing.result("Nakama stale request")
        assertEquals("Off", status); assertTrue(commands.isEmpty()); assertTrue(preparing.closed)
        loop.start(); loop.tick(false)
        now += 59_999; loop.tick(false); assertFalse(created.last().closed)
        now += 1; loop.tick(false); assertTrue(created.last().closed)
        assertFalse(status.contains("Microphone ready"))
    }
    @Test fun brokenBundledModelPausesWithoutRestartingOrSubmitting() {
        for (code in listOf(-200, -201, -202)) {
            var now = 1L; val created = mutableListOf<Fake>(); var status = ""; val commands = mutableListOf<String>()
            val loop = WakeWordLoop({ now }, { result, error -> Fake(true, 60_000L).also { it.result = result; it.error = error; created += it } }, { status = it }, commands::add)
            loop.start(); loop.tick(false); created.single().error(code)
            now += 120_000; loop.tick(false)
            assertFalse(loop.enabled); assertTrue(created.single().closed); assertEquals(1, created.size)
            assertTrue(status.startsWith("Paused")); assertFalse(status.contains("Voice input settings")); assertTrue(commands.isEmpty())
        }
    }

}
