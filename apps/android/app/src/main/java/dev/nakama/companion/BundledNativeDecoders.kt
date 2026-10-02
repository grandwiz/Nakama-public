package dev.nakama.companion

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import java.io.File

/** One immutable model per process; stream operations serialize and each session releases its own stream. */
internal object BundledNativeDecoders {
    private val nativeLock = Any()
    private var shared: OnlineRecognizer? = null
    const val HOTWORD_SCORE = 3.0f
    fun open(context: Context): BundledDecoder {
        val directory = BundledSpeechModel.prepare(context)
        return synchronized(nativeLock) {
            val recognizer = shared ?: create(directory).also { shared = it }
            SignalGuardedDecoder(SherpaDecoder(recognizer, recognizer.createStream(), nativeLock))
        }
    }
    private fun create(directory: File): OnlineRecognizer {
        fun file(name: String) = File(directory, name).also { check(it.isFile) { "The bundled speech model is incomplete." } }.absolutePath
        val config = OnlineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16_000, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = file("encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx"),
                    decoder = file("decoder-epoch-99-avg-1-chunk-16-left-128.onnx"),
                    joiner = file("joiner-epoch-99-avg-1-chunk-16-left-128.onnx"),
                ),
                tokens = file("tokens.txt"), numThreads = 2, debug = false, provider = "cpu",
                modelType = "zipformer2", modelingUnit = "bpe", bpeVocab = file("bpe.vocab"),
            ),
            enableEndpoint = true, decodingMethod = "modified_beam_search", maxActivePaths = 8,
            hotwordsFile = file("hotwords.txt"), hotwordsScore = HOTWORD_SCORE,
        )
        return OnlineRecognizer(config = config)
    }
}
private class SherpaDecoder(
    private val recognizer: OnlineRecognizer,
    private val stream: OnlineStream,
    private val lock: Any,
) : BundledDecoder {
    private var closed = false
    private var finished = false
    override fun accept(samples: ShortArray, count: Int): Boolean = synchronized(lock) {
        check(!closed && !finished && count in 0..samples.size)
        val values = FloatArray(count) { samples[it] / 32768.0f }
        try {
            stream.acceptWaveform(values, 16_000)
            while (recognizer.isReady(stream)) recognizer.decode(stream)
            recognizer.isEndpoint(stream)
        } finally { values.fill(0f) }
    }
    override fun result(): String = synchronized(lock) {
        check(!closed)
        recognizer.getResult(stream).text.also { recognizer.reset(stream) }
    }
    override fun partial(): String = synchronized(lock) { check(!closed); recognizer.getResult(stream).text }
    override fun finish(): String = synchronized(lock) {
        check(!closed)
        if (!finished) {
            // Let the streaming encoder flush its final look-ahead; these samples are synthetic silence.
            val tail = FloatArray(6_400)
            stream.acceptWaveform(tail, 16_000); stream.inputFinished()
            while (recognizer.isReady(stream)) recognizer.decode(stream)
            finished = true
        }
        recognizer.getResult(stream).text
    }
    override fun close() = synchronized(lock) { if (!closed) { closed = true; stream.release() } }
}
