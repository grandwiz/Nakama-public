package dev.nakama.companion

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File

/** The large command model loads only after speech, never for idle keyword monitoring. */
internal object BundledNativeDecoders {
    private val nativeLock = Any()
    private var shared: OfflineRecognizer? = null
    @Volatile var modelLoadMillis: Long = 0L
        private set
    fun open(context: Context): BundledDecoder {
        val directory = BundledSpeechModel.prepare(context)
        val vad = Vad(config = VadModelConfig(
            sileroVadModelConfig = SileroVadModelConfig(model = file(directory, "silero_vad.onnx")),
            sampleRate = 16_000, numThreads = 1, provider = "cpu",
        ))
        return WhisperUtteranceDecoder(vad) { samples -> decode(directory, samples) }
    }
    /** Only called for bounded audio already authorized by the exact stop keyword graph. */
    fun confirmStop(context: Context, samples: ShortArray): String {
        require(samples.size in 1_280..67_072)
        val evidence = BundledSignalEvidence().apply { observe(samples, samples.size) }
        if (!evidence.present) return ""
        val pcm = FloatArray(samples.size) { samples[it] / 32768f }
        return try { decode(BundledSpeechModel.prepare(context), pcm) } finally { pcm.fill(0f) }
    }
    /** Prepare at Stop-listener startup, off the main thread, before a stop candidate arrives. */
    fun prepareStop(context: Context) { synchronized(nativeLock) { recognizer(BundledSpeechModel.prepare(context)) } }
    private fun recognizer(directory: File): OfflineRecognizer = shared ?: run {
            val started = System.nanoTime()
            create(directory).also { shared = it; modelLoadMillis = (System.nanoTime() - started) / 1_000_000 }
        }
    private fun decode(directory: File, samples: FloatArray): String = synchronized(nativeLock) {
        val stream = recognizer(directory).createStream()
        try { stream.acceptWaveform(samples, 16_000); shared!!.decode(stream); shared!!.getResult(stream).text.trim() }
        finally { stream.release() }
    }
    private fun file(directory: File, name: String) = File(directory, name).also {
        check(it.isFile) { "The bundled speech model is incomplete." }
    }.absolutePath
    private fun create(directory: File) = OfflineRecognizer(config = OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = 16_000, featureDim = 80),
        modelConfig = OfflineModelConfig(
            whisper = OfflineWhisperModelConfig(
                encoder = file(directory, "base.en-encoder.int8.onnx"),
                decoder = file(directory, "base.en-decoder.int8.onnx"),
                language = "en", task = "transcribe", tailPaddings = 1000,
            ),
            tokens = file(directory, "base.en-tokens.txt"),
            numThreads = 2, debug = false, provider = "cpu", modelType = "whisper",
        ),
        decodingMethod = "greedy_search",
    ))
}
private class WhisperUtteranceDecoder(
    private val vad: Vad,
    private val decode: (FloatArray) -> String,
) : BundledDecoder {
    private val utterance = BundledUtterance(vad::compute)
    private var closed = false
    override val speechStarted get() = utterance.speechStarted
    override val decodingRequired get() = utterance.speechStarted
    override fun accept(samples: ShortArray, count: Int): Boolean {
        check(!closed)
        return utterance.accept(samples, count)
    }
    override fun result() = finish()
    override fun partial() = ""
    override fun finish(): String {
        check(!closed)
        val samples = utterance.finish()
        return try { if (samples.isEmpty()) "" else decode(samples) }
        finally { samples.fill(0f); vad.reset() }
    }
    override fun close() { if (!closed) { closed = true; utterance.reset(); vad.release() } }
}
