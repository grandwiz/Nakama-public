package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class LocalRecognitionPolicyTest {
    @Test fun onlyAnInstalledOfflineEnglishLanguageMayBeChosen() {
        assertEquals("en-GB", LocalRecognitionPolicy.installedEnglish(listOf("en-US", "fr-FR", "en_GB")))
        assertEquals("en-US", LocalRecognitionPolicy.installedEnglish(listOf("en-US", "de-DE")))
        assertEquals("en-US", LocalRecognitionPolicy.nextEnglishCheck("en-GB"))
        assertNull(LocalRecognitionPolicy.nextEnglishCheck("en-US"))
        assertNull(LocalRecognitionPolicy.nextEnglishCheck("fr-FR"))
        assertNull(LocalRecognitionPolicy.installedEnglish(listOf("fr-FR")))
        assertNull(LocalRecognitionPolicy.installedEnglish(emptyList()))
        assertTrue(LocalRecognitionPolicy.error(13).contains("model is missing"))
        assertTrue(LocalRecognitionPolicy.error(-100).contains("not restart"))
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
