package dev.nakama.companion

/** Bounded endpointing from real VAD probabilities; no text inference from noise or silence. */
internal class BundledUtterance(private val classify: (FloatArray) -> Float) {
    companion object {
        const val WINDOW = 512
        const val MAX_SAMPLES = 20 * 16_000
        private const val PRE_ROLL = 5 * WINDOW
        private const val MIN_SPEECH_WINDOWS = 8
        private const val END_SILENCE_WINDOWS = 19
        private const val RETAINED_TAIL_WINDOWS = 6
    }
    private val window = FloatArray(WINDOW)
    private val retained = FloatArray(MAX_SAMPLES + PRE_ROLL + END_SILENCE_WINDOWS * WINDOW)
    private var windowSize = 0
    private var size = 0
    private var evidence = 0
    private var silence = 0
    var speechStarted = false
        private set
    var ready = false
        private set
    fun accept(samples: ShortArray, count: Int): Boolean {
        check(!ready && count in 0..samples.size)
        for (index in 0 until count) {
            window[windowSize++] = samples[index] / 32768f
            if (windowSize == WINDOW) {
                val voiced = classify(window) >= 0.5f
                if (!speechStarted && evidence == 0 && size >= PRE_ROLL) {
                    // A rejected short fragment may have grown beyond the idle lead.
                    // Contract to the exact bound, not one frame per incoming frame.
                    val keep = PRE_ROLL - WINDOW
                    retained.copyInto(retained, 0, size - keep, size)
                    retained.fill(0f, keep, size)
                    size = keep
                }
                check(size + WINDOW <= retained.size) { "The spoken request is too long." }
                window.copyInto(retained, size); size += WINDOW
                window.fill(0f); windowSize = 0
                if (voiced) { evidence++; silence = 0 } else { silence++ }
                if (!speechStarted && evidence >= MIN_SPEECH_WINDOWS) speechStarted = true
                if (!speechStarted && silence >= MIN_SPEECH_WINDOWS) evidence = 0
                if (speechStarted && size >= MAX_SAMPLES) throw BundledUtteranceTooLong()
                if (speechStarted && silence >= END_SILENCE_WINDOWS) { ready = true; return true }
            }
        }
        return false
    }
    fun finish(): FloatArray {
        if (!speechStarted) { reset(); return FloatArray(0) }
        if (windowSize > 0) { window.copyInto(retained, size, 0, windowSize); size += windowSize }
        // Endpoint confirmation needs 608 ms of classified silence. Whisper receives
        // the speech plus 192 ms of that tail: long real silence is not useful
        // context and can destabilize its short-utterance decoding. Leading audio
        // and all speech are retained; explicit/manual finish never trims audio.
        val length = if (ready) size - (END_SILENCE_WINDOWS - RETAINED_TAIL_WINDOWS) * WINDOW else size
        return retained.copyOf(length).also { reset() }
    }
    fun reset() {
        retained.fill(0f); window.fill(0f); windowSize = 0; size = 0
        evidence = 0; silence = 0; speechStarted = false; ready = false
    }
}
internal class BundledUtteranceTooLong : IllegalStateException("The spoken request is too long. Please use a shorter request.")
