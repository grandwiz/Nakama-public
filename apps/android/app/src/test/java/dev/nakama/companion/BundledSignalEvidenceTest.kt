package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class BundledSignalEvidenceTest {
    @Test fun silenceConstantBiasLowNoiseAndASingleClickCannotAuthorizeWords() {
        for (samples in listOf(ShortArray(16_000), ShortArray(16_000) { 2000 }, ShortArray(16_000) { if (it % 2 == 0) 32 else -32 }, ShortArray(16_000).apply { this[800] = 30_000 })) {
            val gate = BundledSignalEvidence()
            gate.observe(samples, samples.size)
            assertFalse(gate.present)
        }
    }
    @Test fun sustainedSignalSurvivesReadBoundariesAndResetsForEachSegment() {
        val gate = BundledSignalEvidence()
        val samples = ShortArray(960) { if (it % 2 == 0) 500 else -500 }
        for (part in samples.asList().chunked(71)) gate.observe(part.toShortArray(), part.size)
        assertTrue(gate.present)
        gate.observe(ShortArray(1600), 1600); assertTrue(gate.present)
        gate.reset(); gate.observe(ShortArray(1600), 1600); assertFalse(gate.present)
    }
    @Test fun hallucinatingDecoderCannotReturnSilentPartialOrFinalButRealSignalStillPasses() {
        var closed = false
        val raw = object : BundledDecoder {
            override fun accept(samples: ShortArray, count: Int) = true
            override fun partial() = "NAKAMA WHAT TIME IS IT"
            override fun result() = "NAKAMA WHAT TIME IS IT"
            override fun finish() = "NAKAMA WHAT TIME IS IT"
            override fun close() { closed = true }
        }
        val decoder = SignalGuardedDecoder(raw)
        decoder.accept(ShortArray(1600), 1600)
        assertEquals("", decoder.partial()); assertEquals("", decoder.finish()); assertEquals("", decoder.result())
        decoder.accept(ShortArray(1600) { if (it % 2 == 0) 500 else -500 }, 1600)
        assertEquals("NAKAMA WHAT TIME IS IT", decoder.partial())
        assertEquals("NAKAMA WHAT TIME IS IT", decoder.result())
        assertEquals("", decoder.partial()); assertEquals("", decoder.finish())
        decoder.close(); assertTrue(closed)
    }
}
