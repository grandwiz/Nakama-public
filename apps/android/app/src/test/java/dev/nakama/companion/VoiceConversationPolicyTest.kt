package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class VoiceConversationPolicyTest {
    @Test fun followUpExpiresAtThirtySecondsAndStopClearsIt() {
        var now = 10L; val window = FollowUpWindow { now }
        assertFalse(window.active); window.renew(); now += 29_999; assertTrue(window.active)
        now++; assertFalse(window.active); window.renew(); assertTrue(window.active)
        window.clear(); assertFalse(window.active)
    }
    @Test fun stopPhraseIsExactAndOwnOutputDoesNotSpeakIt() {
        listOf("Nakama stop", "Nakama, stop!", "hey nakama stop.").forEach { assertTrue(it, StopCommandPolicy.matches(it)) }
        listOf("stop", "Nakama stock", "Nakama don't stop", "say Nakama stop", "Nakama stop the task and send it", "\"Nakama stop\"").forEach { assertFalse(it, StopCommandPolicy.matches(it)) }
        assertEquals("Say the stop phrase to interrupt.", StopCommandPolicy.forPlayback("Say Nakama stop to interrupt."))
    }
    private class Input : VoiceRecognition {
        lateinit var result: (String) -> Unit; var closed = false
        override fun start() {}
        override fun close() { closed = true }
    }
    @Test fun ordinaryFollowUpNeedsCompletedReplyAndCannotSurviveExpiryOrCancellation() {
        var now = 1L; val wake = mutableListOf<Input>(); val follow = mutableListOf<Input>(); val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, _ -> Input().also { it.result = result; wake += it } }, {}, commands::add,
            createFollowUp = { result, _ -> Input().also { it.result = result; follow += it } })
        loop.start(); loop.tick(false); wake.last().result("set an alarm"); assertTrue(commands.isEmpty())
        loop.allowFollowUp(); now += 300; loop.tick(false); follow.last().result("set an alarm")
        assertEquals(listOf("set an alarm"), commands)
        now += 300; loop.tick(false); assertTrue(wake.size >= 2)
        loop.allowFollowUp(); now += 300; loop.tick(false); val stale = follow.last()
        now += 30_000; loop.tick(false); assertTrue(stale.closed); stale.result("stale command"); assertEquals(1, commands.size)
        loop.allowFollowUp(); now += 300; loop.tick(false); val cancelled = follow.last(); loop.cancelFollowUp(); cancelled.result("cancelled command"); assertEquals(1, commands.size)
        loop.stop()
    }
    @Test fun resumedStopCaptureClearsRejectedCandidateTimeout() {
        var now = 1L; lateinit var ready: () -> Unit; lateinit var ended: () -> Unit
        val input = object : VoiceRecognition {
            override val continuousSession = true
            override fun start() {}
            override fun close() {}
            override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) { ready = onReady; ended = onEnd }
        }
        val loop = WakeWordLoop({ now }, { _, _ -> input }, {}, { fail("No command") }, createStop = { _, _ -> input })
        loop.start(); loop.tick(false, true); ready(); ended(); now += 1000; ready(); now += 90_000; loop.tick(false, true)
        assertTrue(loop.enabled); loop.stop()
    }
    @Test fun stopOnlyCaptureCannotDispatchOrdinaryCommandsOrLateStops() {
        var now = 1L; lateinit var input: Input; var stopped = 0; val commands = mutableListOf<String>()
        val loop = WakeWordLoop({ now }, { result, _ -> Input().also { it.result = result } }, {}, commands::add,
            createStop = { result, _ -> Input().also { it.result = result; input = it } }, onStop = { stopped++ })
        loop.start(); loop.tick(false, stopOnly = true); input.result("Nakama open chrome"); assertTrue(commands.isEmpty()); assertEquals(0, stopped)
        now += 300; loop.tick(false, stopOnly = true); val old = input; input.result("Nakama stop"); assertEquals(1, stopped)
        old.result("Nakama stop"); assertEquals(1, stopped); loop.stop()
    }
}
