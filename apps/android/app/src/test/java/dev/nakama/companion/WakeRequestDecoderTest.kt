package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class WakeRequestDecoderTest {
    private class Keyword(private val detection: WakeDetection?) : BundledKeywordDetector {
        var accepts = 0; var closes = 0
        override fun accept(samples: ShortArray, count: Int): WakeDetection? { accepts++; return if (accepts == 1) detection else null }
        override fun close() { closes++ }
    }
    private class Request : BundledDecoder {
        val accepted = mutableListOf<ShortArray>()
        var endpoint = false; var nextText = ""; var closes = 0; var finishes = 0
        override var speechStarted = false
        override val decodingRequired get() = endpoint
        override fun accept(samples: ShortArray, count: Int): Boolean { accepted += samples.copyOf(count); return endpoint }
        override fun result(): String { endpoint = false; speechStarted = false; return nextText }
        override fun partial() = "unfinished words must stay private"
        override fun finish(): String { finishes++; return nextText }
        override fun close() { closes++ }
    }

    @Test fun keywordHandoverRetainsOnlyCommandSideAudioAndAuthorizesExactlyOneRequest() {
        val keyword = Keyword(WakeDetection("Hey Nakama", 10))
        val request = Request()
        val decoder = WakeRequestDecoder({ keyword }, { request }, { 0 }, boundaryTailSamples = 2)
        try {
            assertTrue(decoder.accept(ShortArray(20) { it.toShort() }, 20))
            assertEquals("Hey Nakama", decoder.result())
            assertArrayEquals(shortArrayOf(12, 13, 14, 15, 16, 17, 18, 19), request.accepted.single())
            assertEquals(1, keyword.closes)
            assertEquals("", decoder.partial())
            request.endpoint = true; request.speechStarted = true; request.nextText = "set a timer for five minutes"
            assertTrue(decoder.accept(shortArrayOf(20, 21), 2))
            assertTrue(decoder.decodingRequired)
            assertEquals("Nakama set a timer for five minutes", decoder.result())
            assertEquals("", decoder.result())
            assertEquals(1, request.closes)
            assertFalse(decoder.accept(shortArrayOf(22), 1))
            assertEquals(2, request.accepted.size)
        } finally { decoder.close() }
        assertEquals(1, request.closes)
    }

    @Test fun requestAlreadyCompleteInsideHandoverSeedEmitsOneCommandWithoutAnExtraWakeOnlyResult() {
        val request = Request().apply { endpoint = true; speechStarted = true; nextText = "what time is it" }
        val decoder = WakeRequestDecoder({ Keyword(WakeDetection("Hey Nakama", 2)) }, { request }, { 0 }, boundaryTailSamples = 0)
        try {
            assertTrue(decoder.accept(shortArrayOf(1, 2, 3, 4), 4))
            assertTrue(decoder.decodingRequired)
            assertArrayEquals(shortArrayOf(3, 4), request.accepted.single())
            assertEquals("Nakama what time is it", decoder.result())
            assertEquals("", decoder.result())
            assertEquals(1, request.closes)
        } finally { decoder.close() }
    }

    @Test fun emptyHandoverSeedResultAnnouncesWakeOnceAndKeepsTheRequestWindow() {
        val request = Request().apply { endpoint = true; nextText = "Hey Nakama" }
        val decoder = WakeRequestDecoder({ Keyword(WakeDetection("Hey Nakama", 2)) }, { request }, { 0 }, boundaryTailSamples = 0)
        try {
            assertTrue(decoder.accept(shortArrayOf(1, 2, 3, 4), 4))
            assertEquals("Hey Nakama", decoder.result())
            assertEquals("", decoder.result())
            assertEquals(0, request.closes)
            request.endpoint = true; request.speechStarted = true; request.nextText = "set a timer for five minutes"
            assertTrue(decoder.accept(shortArrayOf(5), 1))
            assertEquals("Nakama set a timer for five minutes", decoder.result())
        } finally { decoder.close() }
    }

    @Test fun surroundingSpeechCannotStartRequestDecodingWithoutAKeywordEvent() {
        val keyword = Keyword(null)
        val decoder = WakeRequestDecoder({ keyword }, { error("No wake authority to open ASR") }, { 0 })
        try {
            repeat(30) { assertFalse(decoder.accept(ShortArray(1600) { 25 }, 1600)) }
            assertEquals("", decoder.result()); assertEquals("", decoder.partial()); assertEquals("", decoder.finish())
        } finally { decoder.close() }
        assertEquals(1, keyword.closes)
    }

    @Test fun asrReturningOnlyTheWakeNameDoesNotConsumeOrFreezeTheCommandWindow() {
        val request = Request()
        val decoder = WakeRequestDecoder({ Keyword(WakeDetection("Nakama", 2)) }, { request }, { 0 }, boundaryTailSamples = 0)
        try {
            assertTrue(decoder.accept(shortArrayOf(1, 2), 2)); assertEquals("Nakama", decoder.result())
            request.endpoint = true; request.speechStarted = true; request.nextText = "Hey Nakama"
            assertTrue(decoder.accept(shortArrayOf(3), 1)); assertEquals("", decoder.result())
            assertEquals("A bare ASR wake name must leave a request window available", 0, request.closes)
            request.endpoint = true; request.speechStarted = true; request.nextText = "what time is it"
            assertTrue(decoder.accept(shortArrayOf(4), 1))
            assertEquals("Nakama what time is it", decoder.result())
            assertEquals(1, request.closes)
        } finally { decoder.close() }
    }

    @Test fun silentOrEmptyRequestExpiresAndFreshKeywordStartsWithFreshAudioOffsets() {
        var clock = 0L
        val keywords = mutableListOf<Keyword>(); val requests = mutableListOf<Request>()
        val decoder = WakeRequestDecoder(
            { Keyword(WakeDetection("Nakama", 2)).also(keywords::add) },
            { Request().also(requests::add) }, { clock }, boundaryTailSamples = 0,
        )
        try {
            assertTrue(decoder.accept(shortArrayOf(1, 2), 2)); assertEquals("Nakama", decoder.result())
            requests.single().endpoint = true; requests.single().nextText = "Nakama"
            assertTrue(decoder.accept(shortArrayOf(3), 1)); assertEquals("", decoder.result())
            clock = 15_001
            assertFalse(decoder.accept(shortArrayOf(4), 1))
            assertEquals(1, requests.first().closes); assertEquals(2, keywords.size)
            assertTrue(decoder.accept(shortArrayOf(8, 9, 10), 3)); assertEquals("Nakama", decoder.result())
            assertEquals(2, requests.size)
            assertArrayEquals(shortArrayOf(10), requests.last().accepted.single())
        } finally { decoder.close() }
        assertEquals(1, requests.last().closes)
    }

    @Test fun stopClosesPendingRequestWithoutFlushingUnfinishedCommand() {
        val keyword = Keyword(WakeDetection("Nakama", 2)); val request = Request()
        val decoder = WakeRequestDecoder({ keyword }, { request }, { 0 }, boundaryTailSamples = 0)
        assertTrue(decoder.accept(shortArrayOf(1, 2), 2)); assertEquals("Nakama", decoder.result())
        request.speechStarted = true; request.nextText = "unfinished private command"
        decoder.close(); decoder.close()
        assertEquals(1, keyword.closes); assertEquals(1, request.closes); assertEquals(0, request.finishes)
        assertThrows(IllegalStateException::class.java) { decoder.accept(shortArrayOf(3), 1) }
        assertThrows(IllegalStateException::class.java) { decoder.result() }
        assertThrows(IllegalStateException::class.java) { decoder.finish() }
    }

    @Test fun boundedAudioWindowRejectsAnOverwrittenWakeBoundaryInsteadOfReusingEarlierAudio() {
        val window = WakePcmWindow(4)
        window.append(shortArrayOf(0, 1, 2, 3, 4, 5), 6)
        assertThrows(IllegalArgumentException::class.java) { window.from(1) }
        assertArrayEquals(shortArrayOf(2, 3, 4, 5), window.from(2))
        assertArrayEquals(shortArrayOf(4, 5), window.from(4))
        window.clear()
        assertTrue(window.from(0).isEmpty())
        window.append(shortArrayOf(8, 9), 2)
        assertArrayEquals(shortArrayOf(8, 9), window.from(0))
    }
}
