package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class LocalRecognitionPolicyTest {
    @Test fun failuresDistinguishBundledPreparationFromOptionalAndroidService() {
        for (code in listOf(-200, -201, -202)) {
            val detail = LocalRecognitionPolicy.error(code)
            assertTrue(detail.contains("bundled", true))
            assertFalse(detail.contains("Download its local model"))
        }
        for (code in listOf(1, 2, 10, 12, 13)) assertTrue(LocalRecognitionPolicy.error(code).contains("optional Android recognition service"))
        assertTrue(LocalRecognitionPolicy.error(-100).contains("not restart"))
        assertFalse(LocalRecognitionPolicy.error(13).contains("Download"))
    }
    @Test fun boundedPipeWritesPreserveOffsetsAndStopPromptlyOnCancellation() {
        var now = 0L; val offsets = mutableListOf<Int>()
        assertTrue(PcmWritePolicy.write(6, { true }, { now }, { offset, count -> offsets += offset; minOf(count, 2) }, { now++ }))
        assertEquals(listOf(0, 2, 4), offsets)
        var active = true; var calls = 0
        assertFalse(PcmWritePolicy.write(100, { active }, { now }, { _, _ -> calls++; 0 }, { active = false }))
        assertEquals(1, calls)
    }
    @Test fun stalledRecognizerPipeFailsWithoutBlockingOrUnboundedBuffering() {
        var now = 0L
        try { PcmWritePolicy.write(4_096, { true }, { now }, { _, _ -> 0 }, { now += 100 }); fail("Expected bounded stall failure") }
        catch (_: java.io.IOException) { assertEquals(2_000, now) }
    }
}
