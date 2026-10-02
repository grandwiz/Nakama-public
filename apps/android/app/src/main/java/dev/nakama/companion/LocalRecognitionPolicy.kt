package dev.nakama.companion

internal object LocalRecognitionPolicy {
    /** Only the engine's explicitly installed offline English models can be selected. */
    fun installedEnglish(languages: List<String>): String? {
        val installed = languages.map { it.replace('_', '-') }.filter { it.equals("en", true) || it.startsWith("en-", true) }.distinct()
        return installed.firstOrNull { it.equals("en-GB", true) }
            ?: installed.firstOrNull { it.equals("en", true) }
            ?: installed.firstOrNull { it.equals("en-US", true) }
            ?: installed.sorted().firstOrNull()
    }
    fun nextEnglishCheck(language: String): String? = if (language.equals("en-GB", true)) "en-US" else null
    fun error(error: Int): String = when (error) {
        -100 -> "This recognizer ended the continuous audio session. Quiet wake listening is unsupported here; use Talk or choose another on-device service. Nakama will not restart it repeatedly or mute device sounds."
        1, 2 -> "The on-device recognizer reported a connection error ($error). Check its offline language download. No cloud fallback was used."
        3 -> "Android could not capture microphone audio (3). Close other microphone apps and check the system microphone privacy switch."
        5 -> "Android's local recognizer stopped unexpectedly (5). Tap Restart wake listening; check Voice input settings if it repeats."
        8 -> "The local recognizer is busy (8). Finish Talk, calls or another voice assistant, then restart wake listening."
        9 -> "Microphone permission is unavailable (9). Allow Nakama's microphone and check the system microphone privacy switch."
        10 -> "Android limited recognition requests (10). Wait briefly, then restart wake listening."
        12 -> "This local recognizer does not support English (12). Select a compatible on-device service in Android Voice input settings."
        13 -> "The offline English speech model is missing (13). Download its local model below or in Android Voice input settings, then restart."
        else -> "The local recognizer stopped (Android code $error). Check Android Voice input settings, then restart wake listening."
    }
}
