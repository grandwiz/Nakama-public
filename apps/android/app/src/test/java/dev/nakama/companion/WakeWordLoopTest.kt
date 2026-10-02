package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class WakeWordLoopTest {
    private class Fake : VoiceRecognition {
        lateinit var result: (String) -> Unit
        lateinit var error: (Int) -> Unit
        var started = false; var closed = false
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
}
