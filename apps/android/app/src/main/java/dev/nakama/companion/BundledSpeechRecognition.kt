package dev.nakama.companion

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/** Bundled ASR for Talk and continuous wake; construction never opens a microphone or loads a model. */
internal class BundledSpeechRecognition(
    context: Context,
    continuous: Boolean,
    private val onReady: () -> Unit = {},
    private val onEnd: () -> Unit = {},
    private val onResult: (String) -> Unit,
    private val onError: (Int) -> Unit,
) : VoiceRecognition {
    companion object {
        private val diagnosticGeneration = AtomicLong()
        fun available(context: Context) = BundledSpeechModel.available(context)
    }
    override val continuousSession = continuous
    override val startupTimeoutMillis = 60_000L
    override val completionTimeoutMillis = 60_000L
    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var closed = false
    private var started = false
    private var diagnosticToken = 0L
    private var readyObserver: () -> Unit = {}
    private var endObserver: () -> Unit = {}
    private var partialObserver: (String) -> Unit = {}
    private fun diagnostic(text: String) {
        if (!closed && diagnosticToken == diagnosticGeneration.get()) LocalSpeechStatus.update(text)
    }
    private val session = BundledRecognitionSession(
        continuous = continuous,
        decoderFactory = { if (continuous) BundledWakeDecoders.open(appContext) else BundledNativeDecoders.open(appContext) },
        audioFactory = { BufferedBundledAudio(BundledMicrophone(), launch = { work ->
            thread(name = "Nakama microphone capture", isDaemon = true) {
                runCatching { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO) }
                work()
            }
        }) },
        worker = { work -> thread(name = "Nakama bundled speech", isDaemon = true, block = work) },
        post = { callback -> handler.post { callback() } },
        now = SystemClock::elapsedRealtime,
        ready = { diagnostic("Bundled offline English is ready. Speech audio stays on this device."); onReady(); if (!closed) readyObserver() },
        ended = { onEnd(); if (!closed) endObserver() },
        result = onResult,
        processing = { diagnostic("Recognizing your request offline. Audio stays on this device."); onEnd(); if (!closed) endObserver() },
        partial = { partialObserver(it) },
        failure = { code -> diagnostic(LocalRecognitionPolicy.error(code)); onError(code) },
    )
    override fun start() {
        if (closed || started) return
        started = true; diagnosticToken = diagnosticGeneration.incrementAndGet()
        diagnostic("Preparing the bundled offline English model. Microphone readiness is not yet confirmed.")
        session.start()
    }
    override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) {
        readyObserver = onReady; endObserver = onEnd; partialObserver = onPartial
    }
    override fun stopListening() { session.stopListening() }
    override fun close() {
        closed = true; session.close(); handler.removeCallbacksAndMessages(null)
        readyObserver = {}; endObserver = {}; partialObserver = {}
    }
}

/** The dedicated capture thread drains AudioRecord; no OS SpeechRecognizer or audio files. */
private class BundledMicrophone : BundledAudio {
    companion object { const val SAMPLE_RATE = 16_000 }
    @Volatile private var input: AudioRecord? = null
    @Volatile private var stopped = false
    @SuppressLint("MissingPermission") // Talk and the explicit microphone service check RECORD_AUDIO; SecurityException is still handled.
    override fun start() {
        if (stopped) return
        val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "Android does not support the bundled microphone format." }
        if (stopped) return
        val recorder = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
            .setBufferSizeInBytes(maxOf(minimum, 32_000)).build().also { input = it }
        check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Android microphone could not initialize." }
        if (stopped) return
        recorder.startRecording()
        if (stopped) { runCatching { recorder.stop() }; return }
        check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Android microphone did not start." }
    }
    override fun read(samples: ShortArray): Int = if (stopped) 0 else input?.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING) ?: -1
    override fun stop() { stopped = true; runCatching { input?.stop() } }
    override fun close() { stop(); runCatching { input?.release() }; input = null }
}
