package dev.nakama.companion

internal object LocalRecognitionPolicy {
    fun error(error: Int): String = when (error) {
        -200 -> "The bundled English model is missing or damaged. Install a complete Nakama update; no model download is needed in Android settings."
        -201 -> "Bundled speech could not initialize. Check free storage and restart Nakama. Audio was not sent to another recognition service."
        -202 -> "Bundled speech could not capture microphone audio. Close other microphone apps, check microphone permission and the system privacy switch, then retry."
        -100 -> "The continuous audio session ended unexpectedly. Quiet wake listening is unsupported in this session; restart Nakama or use Talk. Nakama will not restart it repeatedly or mute device sounds."
        1, 2 -> "The optional Android recognition service reported a connection error ($error). You can use bundled offline recognition or type; no service switch was made."
        3 -> "Android could not capture microphone audio (3). Close other microphone apps and check the system microphone privacy switch."
        5 -> "The local recognizer stopped unexpectedly (5). Tap Restart wake listening or reopen Nakama if it repeats."
        8 -> "The local recognizer is busy (8). Finish Talk, calls or another voice assistant, then restart wake listening."
        9 -> "Microphone permission is unavailable (9). Allow Nakama's microphone and check the system microphone privacy switch."
        10 -> "The optional Android recognition service limited requests (10). Wait briefly before trying Talk again."
        12 -> "The optional Android recognition service does not support the requested English language (12). Use bundled recognition or configure that service in Android voice input settings."
        13 -> "The optional Android recognition service reports English unavailable (13). Use bundled recognition or check that service in Android voice input settings."
        else -> "Speech recognition stopped (code $error). Restart Nakama and check microphone permission; no automatic service fallback was used."
    }
}
