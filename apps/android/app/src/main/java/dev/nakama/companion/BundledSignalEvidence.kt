package dev.nakama.companion

/**
 * Acoustic evidence, not a speech classifier: digital silence, DC bias and isolated clicks cannot
 * authorize a transcript. It never stores PCM or tries to infer words, speakers, or identity.
 */
internal class BundledSignalEvidence {
    private var frameSamples = 0
    private var sum = 0.0
    private var squares = 0.0
    private var consecutiveFrames = 0
    var present = false; private set
    fun observe(samples: ShortArray, count: Int) {
        require(count in 0..samples.size)
        for (index in 0 until count) {
            val value = samples[index].toDouble()
            sum += value; squares += value * value; frameSamples++
            if (frameSamples == 320) { // 20 ms at 16 kHz, independent of microphone read sizes.
                val mean = sum / frameSamples
                val variance = (squares / frameSamples - mean * mean).coerceAtLeast(0.0)
                consecutiveFrames = if (variance >= 64.0 * 64.0) minOf(3, consecutiveFrames + 1) else 0
                if (consecutiveFrames >= 3) present = true // At least 60 ms of varying signal.
                frameSamples = 0; sum = 0.0; squares = 0.0
            }
        }
    }
    fun reset() { frameSamples = 0; sum = 0.0; squares = 0.0; consecutiveFrames = 0; present = false }
}

/** Model hypotheses alone never turn a silent audio segment into a partial or final command. */
internal class SignalGuardedDecoder(private val decoder: BundledDecoder) : BundledDecoder {
    private val evidence = BundledSignalEvidence()
    override fun accept(samples: ShortArray, count: Int): Boolean {
        evidence.observe(samples, count)
        return decoder.accept(samples, count)
    }
    override fun result(): String {
        val text = decoder.result()
        val allowed = evidence.present
        evidence.reset()
        return if (allowed) text else ""
    }
    override fun partial() = if (evidence.present) decoder.partial() else ""
    override fun finish(): String {
        val text = decoder.finish()
        return if (evidence.present) text else ""
    }
    override fun close() { evidence.reset(); decoder.close() }
}
