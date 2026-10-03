package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class BundledStopDecoderTest {
    private class Keyword(private val boundary: Long? = 0) : BundledKeywordDetector {
        var closed = false
        override fun accept(samples: ShortArray, count: Int) = WakeDetection("Nakama stop", count.toLong(), 0, boundary)
        override fun close() { closed = true }
    }
    @Test fun onlyStopVocabularyConfirmsAndTransientPcmIsErased() {
        for ((transcript, expected) in listOf("Stop." to true, "stop stop stop" to true, "stock" to false, "start" to false, "stop timer" to false, "don't stop" to false, "" to false)) {
            val keywords = mutableListOf<Keyword>(); var received: ShortArray? = null
            val decoder = BundledStopDecoder({ Keyword().also { keywords += it } }, { received = it; transcript })
            assertTrue(decoder.accept(ShortArray(1600) { 500 }, 1600))
            assertEquals(if (expected) "Nakama stop" else "", decoder.result())
            assertTrue(received!!.all { it == 0.toShort() }); assertTrue(keywords.first().closed)
            assertEquals("", decoder.finish()); decoder.close(); assertTrue(keywords.last().closed)
        }
    }
    @Test fun missingBoundaryAndCancellationNeverConfirm() {
        var called = false
        val missing = BundledStopDecoder({ Keyword(null) }, { called = true; "stop" })
        assertFalse(missing.accept(ShortArray(1600), 1600)); assertEquals("", missing.finish()); missing.close()
        val cancelled = BundledStopDecoder({ Keyword() }, { called = true; "stop" })
        assertTrue(cancelled.accept(ShortArray(1600), 1600)); cancelled.close(); assertFalse(called)
    }
}
