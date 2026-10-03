package dev.nakama.companion

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import java.io.File
import kotlin.math.roundToLong

/** Only exact configured keyword labels can authorize a following request. */
internal data class WakeDetection(val phrase: String, val lastTokenSample: Long, val firstTokenSample: Long? = null, val requestBoundarySample: Long? = null)
internal interface BundledKeywordDetector {
    fun accept(samples: ShortArray, count: Int): WakeDetection?
    fun close()
}

/** Lightweight, dedicated keyword network. It never transcribes surrounding conversation. */
internal object BundledKeywordSpotters {
    private val nativeLock = Any()
    private var shared: KeywordSpotter? = null
    private var stopShared: KeywordSpotter? = null
    fun open(context: Context, stopOnly: Boolean = false): BundledKeywordDetector {
        val folder = File(BundledSpeechModel.prepare(context), "wake")
        return synchronized(nativeLock) {
            // Sherpa adds stream keywords to defaults, so Stop needs a separate keyword graph.
            val spotter = if (stopOnly) stopShared ?: create(folder, true).also { stopShared = it }
                else shared ?: create(folder, false).also { shared = it }
            NativeKeywordDetector(spotter, spotter.createStream(), nativeLock)
        }
    }
    private fun create(folder: File, stopOnly: Boolean): KeywordSpotter {
        fun file(name: String) = File(folder, name).also { check(it.isFile) { "The bundled wake model is incomplete." } }.absolutePath
        return KeywordSpotter(config = KeywordSpotterConfig(
            featConfig = FeatureConfig(sampleRate = 16_000, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = file("encoder-epoch-12-avg-2-chunk-16-left-64.onnx"),
                    decoder = file("decoder-epoch-12-avg-2-chunk-16-left-64.onnx"),
                    joiner = file("joiner-epoch-12-avg-2-chunk-16-left-64.onnx"),
                ),
                tokens = file("tokens.txt"), numThreads = 1, provider = "cpu", modelType = "zipformer2",
            ),
            maxActivePaths = 8, keywordsFile = file(if (stopOnly) "stop-keywords.txt" else "keywords.txt"),
            keywordsScore = 1.5f, keywordsThreshold = 0.25f, numTrailingBlanks = 2,
        ))
    }
}

private class NativeKeywordDetector(
    private val spotter: KeywordSpotter,
    private val stream: OnlineStream,
    private val lock: Any,
) : BundledKeywordDetector {
    private val evidence = BundledSignalEvidence()
    private var closed = false
    private var acceptedSamples = 0L
    override fun accept(samples: ShortArray, count: Int): WakeDetection? = synchronized(lock) {
        check(!closed && count in 0..samples.size)
        evidence.observe(samples, count)
        acceptedSamples += count
        val values = FloatArray(count) { samples[it] / 32768.0f }
        try {
            stream.acceptWaveform(values, 16_000)
            var hit: WakeDetection? = null
            while (spotter.isReady(stream)) {
                spotter.decode(stream)
                val result = spotter.getResult(stream)
                val phrase = when (result.keyword) { "NAKAMA" -> "Nakama"; "HEY_NAKAMA" -> "Hey Nakama"; "NAKAMA_STOP" -> "Nakama stop"; else -> null }
                val timestamp = result.timestamps.lastOrNull()
                if (hit == null && evidence.present && phrase != null && timestamp != null && timestamp.isFinite() && timestamp >= 0f) {
                    val sample = (timestamp.toDouble() * 16_000).roundToLong()
                    if (sample in 0..acceptedSamples) {
                        fun at(index: Int) = result.timestamps.getOrNull(index)?.takeIf { it.isFinite() && it >= 0f }?.let { (it.toDouble() * 16_000).roundToLong() }
                        hit = WakeDetection(phrase, sample, at(0), if (result.keyword == "NAKAMA_STOP") at(3)?.plus(1_280L) else null)
                    }
                }
            }
            hit
        } finally { values.fill(0f) }
    }
    override fun close() = synchronized(lock) {
        if (!closed) { closed = true; evidence.reset(); stream.release() }
    }
}
