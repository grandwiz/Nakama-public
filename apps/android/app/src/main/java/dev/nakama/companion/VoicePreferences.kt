package dev.nakama.companion

/** Android engines supply these traits; voice gender is intentionally not inferred from names. */
data class InstalledVoice(val name: String, val language: String, val country: String, val needsNetwork: Boolean, val needsDownload: Boolean = false) {
    val usableOffline get() = !needsNetwork && !needsDownload
    val detail get() = when {
        needsDownload -> "Voice data needed · unavailable"
        needsNetwork -> "Internet needed · unavailable in offline mode"
        else -> "Offline · reported by your Android engine"
    }
}

data class VoicePreferences(val engine: String = "", val voice: String = "", val rate: Float = 1f, val allowSystemRecognition: Boolean = false)

object VoicePolicy {
    /** Bound each TTS utterance without cutting off ordinary recipes or multi-step answers. */
    fun speechChunks(text: String): List<String> {
        val plain = text.replace(Regex("```[\\s\\S]*?```"), " Code is available in the conversation. ").replace(Regex("[*#`]"), "").trim()
        if (plain.isBlank()) return emptyList()
        val bounded = if (plain.length > 24_000) plain.take(24_000) + " The remaining text is available in your conversation." else plain
        val chunks = mutableListOf<String>()
        var remaining = bounded
        while (remaining.length > 3_000) {
            val boundary = remaining.lastIndexOf(' ', 3_000).takeIf { it >= 1_500 } ?: 3_000
            chunks += remaining.take(boundary).trim()
            remaining = remaining.substring(boundary).trimStart()
        }
        if (remaining.isNotBlank()) chunks += remaining
        return chunks
    }
    val rates = linkedMapOf("Slower" to 0.85f, "Normal" to 1f, "Faster" to 1.15f)
    fun safeRate(rate: Float) = rates.values.firstOrNull { it == rate } ?: 1f
    fun britishVoices(voices: List<InstalledVoice>) = voices
        .filter { it.language.equals("en", true) && it.country.equals("GB", true) && it.name.isNotBlank() }
        .distinctBy { it.name }.sortedWith(compareBy({ !it.usableOffline }, { it.name }))
    fun choose(voices: List<InstalledVoice>, engine: String, preferences: VoicePreferences): InstalledVoice? {
        val available = britishVoices(voices).filter { it.usableOffline }
        // Older versions stored only a voice name. Explicit choices now bind it to its engine.
        val saved = preferences.voice.takeIf { preferences.engine.isBlank() || preferences.engine == engine }
        return available.find { it.name == saved } ?: available.firstOrNull()
    }
    fun recognitionMode(onDevice: Boolean, system: Boolean, allowSystem: Boolean) = when {
        onDevice -> RecognitionMode.ON_DEVICE
        system && allowSystem -> RecognitionMode.SYSTEM
        system -> RecognitionMode.NEEDS_OPT_IN
        else -> RecognitionMode.UNAVAILABLE
    }
}

enum class RecognitionMode(val explanation: String) {
    ON_DEVICE("On-device recognition preferred. British English voice data must be installed; availability is checked when you tap Talk."),
    SYSTEM("Android recognition service enabled. It may send audio to its provider; the offline preference is not a guarantee."),
    NEEDS_OPT_IN("No on-device recognizer found. You can type, install offline recognition in Android settings, or allow the Android recognition service below."),
    UNAVAILABLE("No recognition service found. You can still type. Enable a speech recognition service in Android settings, then refresh voices."),
}

interface VoicePreferenceStore {
    fun read(): VoicePreferences
    fun write(preferences: VoicePreferences)
}
