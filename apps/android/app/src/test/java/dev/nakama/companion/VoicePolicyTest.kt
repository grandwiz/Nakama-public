package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class VoicePolicyTest {
    private val offline = InstalledVoice("british-local", "en", "GB", false)
    private val second = offline.copy(name = "z-second")
    private val network = offline.copy(name = "female-cloud", needsNetwork = true)
    private val download = offline.copy(name = "download", needsDownload = true)
    private val voices = listOf(network, download, second, offline, offline.copy(country = "US"), offline.copy(language = "fr"))

    @Test fun britishCatalogueSeparatesUnavailableVoicesWithoutGenderGuesses() {
        assertEquals(listOf(offline, second, download, network), VoicePolicy.britishVoices(voices))
        assertEquals(offline, VoicePolicy.choose(voices, "engine", VoicePreferences()))
        assertTrue(network.detail.contains("Internet needed"))
        assertFalse(network.usableOffline)
        assertFalse(download.usableOffline)
    }
    @Test fun explicitVoicePersistsOnlyWithinItsEngineAndNeverSelectsNetworkOrMissingData() {
        assertEquals(second, VoicePolicy.choose(voices, "engine", VoicePreferences("engine", second.name)))
        assertEquals(offline, VoicePolicy.choose(voices, "another-engine", VoicePreferences("engine", second.name)))
        assertEquals(second, VoicePolicy.choose(voices, "engine", VoicePreferences(voice = second.name)))
        for (missing in listOf(network.name, download.name, "removed")) assertEquals(offline, VoicePolicy.choose(voices, "engine", VoicePreferences(voice = missing)))
        assertNull(VoicePolicy.choose(listOf(network, download), "engine", VoicePreferences()))
    }
    @Test fun invalidSpeedsUseNormalWithoutAllowingUnboundedOrNonfiniteValues() {
        for (invalid in listOf(-1f, 0f, 50f, Float.NaN, Float.POSITIVE_INFINITY)) assertEquals(1f, VoicePolicy.safeRate(invalid), 0f)
        for (speed in VoicePolicy.rates.values) assertEquals(speed, VoicePolicy.safeRate(speed), 0f)
    }
    @Test fun recognitionNeverSilentlyFallsBackToPotentiallyNetworkService() {
        for (allow in listOf(false, true)) assertEquals(RecognitionMode.ON_DEVICE, VoicePolicy.recognitionMode(true, true, allow))
        assertEquals(RecognitionMode.NEEDS_OPT_IN, VoicePolicy.recognitionMode(false, true, false))
        assertEquals(RecognitionMode.SYSTEM, VoicePolicy.recognitionMode(false, true, true))
        assertEquals(RecognitionMode.UNAVAILABLE, VoicePolicy.recognitionMode(false, false, true))
    }
}
