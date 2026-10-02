package dev.nakama.companion

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.ModelDownloadListener
import androidx.compose.runtime.*
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

internal class AndroidVoicePreferenceStore(context: Context, preferenceName: String = "nakama_preferences") : VoicePreferenceStore {
    private val prefs = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
    override fun read() = VoicePreferences(
        engine = prefs.getString("voiceEngine", "").orEmpty(), voice = prefs.getString("voice", "").orEmpty(),
        rate = VoicePolicy.safeRate(prefs.getFloat("voiceRate", 1f)), allowSystemRecognition = prefs.getBoolean("allowSystemRecognition", false),
    )
    override fun write(preferences: VoicePreferences) {
        prefs.edit().putString("voiceEngine", preferences.engine).putString("voice", preferences.voice)
            .putFloat("voiceRate", VoicePolicy.safeRate(preferences.rate)).putBoolean("allowSystemRecognition", preferences.allowSystemRecognition).apply()
    }
}

internal interface VoicePlayback {
    val engine: String
    fun initialize(onReady: (Boolean) -> Unit, onFinished: (String, Boolean) -> Unit)
    fun voices(): List<InstalledVoice>
    fun select(name: String): Boolean
    fun rate(value: Float): Boolean
    fun speak(text: String, id: String): Boolean
    fun stop()
    fun close()
}
internal interface VoiceRecognition {
    val continuousSession: Boolean get() = false
    fun start()
    fun close()
    fun stopListening() {}
    fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) {}
}
internal interface VoiceServices {
    fun playback(): VoicePlayback
    fun onDeviceRecognitionAvailable(): Boolean
    fun systemRecognitionAvailable(): Boolean
    fun recognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition
}

/** Separate callback wiring can be exercised without opening a microphone or binding a service. */
internal fun recognitionCallbacks(onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onFailure: (Int) -> Unit, onPartial: (String) -> Unit = {}, onSegment: (String) -> Unit = {}, onSegmentedEnd: () -> Unit = {}) = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = onReady()
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(value: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = onEnd()
    override fun onError(error: Int) = onFailure(error)
    override fun onResults(results: Bundle?) = onResult(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
    override fun onPartialResults(results: Bundle?) = onPartial(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
    override fun onSegmentResults(results: Bundle) = onSegment(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
    override fun onEndOfSegmentedSession() = onSegmentedEnd()
    override fun onEvent(type: Int, params: Bundle?) = Unit
}

/** Diagnostic metadata only: no recognised words, microphone audio or pre-wake transcript are retained. */
internal object LocalSpeechStatus {
    var detail by mutableStateOf("Offline model not checked yet. Enable wake listening to check this device."); private set
    internal fun update(value: String) { detail = value }
}

internal fun speechIntent(language: String = "en-GB", source: android.os.ParcelFileDescriptor? = null) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    .apply { if (source != null) {
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, source)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, android.media.AudioFormat.ENCODING_PCM_16BIT)
        putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, LocalPcmSource.SAMPLE_RATE)
        putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
        putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, arrayListOf("Nakama", "Hey Nakama"))
    } }

internal class AndroidVoiceServices(private val context: Context) : VoiceServices {
    private var checkedLanguage: String? = null
    override fun playback(): VoicePlayback = AndroidVoicePlayback(context)
    override fun onDeviceRecognitionAvailable() = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    override fun systemRecognitionAvailable() = SpeechRecognizer.isRecognitionAvailable(context)
    override fun recognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition = createRecognition(onDevice, onReady, onEnd, onResult, onError, false)
    fun wakeRecognition(onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition = createRecognition(true, {}, {}, onResult, onError, true)
    private fun createRecognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit, continuous: Boolean): VoiceRecognition {
        val recognizer = if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        val handler = Handler(Looper.getMainLooper())
        var closed = false; var supportFinished = false
        val capture = try { if (continuous) LocalPcmSource { if (!closed) onError(SpeechRecognizer.ERROR_AUDIO) } else null }
            catch (failure: Exception) { recognizer.destroy(); throw failure }
        fun inputIntent(language: String = "en-GB") = speechIntent(language, capture?.descriptor)
        var readyObserver: () -> Unit = {}; var endObserver: () -> Unit = {}; var partialObserver: (String) -> Unit = {}
        recognizer.setRecognitionListener(recognitionCallbacks(
            { if (!closed) { onReady(); readyObserver() } },
            { if (!closed) { onEnd(); endObserver() } },
            { if (!closed) { if (continuous) onError(-100) else onResult(it) } },
            { if (!closed) { if (onDevice && it !in setOf(6, 7, 8, 10)) { checkedLanguage = null; LocalSpeechStatus.update(LocalRecognitionPolicy.error(it)) }; onError(it) } },
            { if (!closed) partialObserver(it) },
            { if (!closed && continuous) onResult(it) },
            { if (!closed && continuous) onError(-100) },
        ))
        fun begin(language: String) {
            if (closed || supportFinished) return
            supportFinished = true; handler.removeCallbacksAndMessages(null)
            try { recognizer.startListening(inputIntent(language)); capture?.start() }
            catch (_: Exception) { capture?.close(); if (!closed) onError(SpeechRecognizer.ERROR_AUDIO) }
        }
        return object : VoiceRecognition {
            override val continuousSession = continuous
            override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) { readyObserver = onReady; endObserver = onEnd; partialObserver = onPartial }
            override fun start() {
                if (!onDevice) { begin("en-GB"); return }
                checkedLanguage?.let { begin(it); return }
                LocalSpeechStatus.update("Checking installed on-device English speech models...")
                // Some vendor recognizers cannot report support. A bounded local-only attempt still
                // gets an honest Ready callback or an actionable error; never switch to cloud input.
                var requestedLanguage = "en-GB"
                handler.postDelayed({ if (!closed && !supportFinished) { LocalSpeechStatus.update("This recognizer did not report its model list. Trying local $requestedLanguage; wait for Microphone ready."); begin(requestedLanguage) } }, 2_500)
                fun checkLanguage(requested: String) {
                    requestedLanguage = requested
                    recognizer.checkRecognitionSupport(inputIntent(requested), context.mainExecutor, object : RecognitionSupportCallback {
                        fun tryNext(): Boolean {
                            val next = LocalRecognitionPolicy.nextEnglishCheck(requested) ?: return false
                            LocalSpeechStatus.update("Offline $requested is unavailable. Checking installed local $next; no cloud fallback.")
                            checkLanguage(next); return true
                        }
                        override fun onSupportResult(support: RecognitionSupport) {
                            if (closed || supportFinished) return
                            val language = LocalRecognitionPolicy.installedEnglish(support.installedOnDeviceLanguages)
                            if (language != null) {
                                checkedLanguage = language
                                LocalSpeechStatus.update("Installed offline recognition: $language. Wake audio stays on this device.")
                                begin(language)
                            } else if (!tryNext()) {
                                supportFinished = true; handler.removeCallbacksAndMessages(null)
                                val pending = LocalRecognitionPolicy.installedEnglish(support.pendingOnDeviceLanguages)
                                LocalSpeechStatus.update(if (pending != null) "Offline $pending model download is pending. Finish the download, then restart wake listening." else "No installed offline English speech model was reported. Download local English below or use Android Voice input settings.")
                                onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
                            }
                        }
                        override fun onError(error: Int) {
                            if (closed || supportFinished) return
                            if (error in setOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)) {
                                if (!tryNext()) { supportFinished = true; handler.removeCallbacksAndMessages(null); LocalSpeechStatus.update(LocalRecognitionPolicy.error(error)); onError(error) }
                            } else {
                                LocalSpeechStatus.update("This recognizer cannot check model support (code $error). Trying local $requested; wait for Microphone ready.")
                                begin(requested)
                            }
                        }
                    })
                }
                checkLanguage(requestedLanguage)
            }
            override fun stopListening() { if (!closed && supportFinished) recognizer.stopListening() }
            override fun close() { closed = true; handler.removeCallbacksAndMessages(null); capture?.close(); try { recognizer.cancel() } finally { recognizer.destroy() } }
        }
    }
}

/** Only called from an explicit setup button; this downloads model data, never uploads microphone audio. */
internal object LocalSpeechSetup {
    private var download: SpeechRecognizer? = null
    fun downloadEnglish(context: Context) {
        if (download != null) { LocalSpeechStatus.update("A local model download was already requested. Check Android Voice input settings for its progress."); return }
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) { LocalSpeechStatus.update("Android reports no on-device recognition service. Select or install a compatible service in Voice input settings."); return }
        val recognizer = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }.getOrElse {
            LocalSpeechStatus.update("Android could not open its on-device service. Check Voice input settings before downloading a model."); return
        }.also { download = it }
        recognizer.setRecognitionListener(recognitionCallbacks({}, {}, {}, {}))
        val handler = Handler(Looper.getMainLooper()); var finished = false
        fun finish(detail: String) { if (finished) return; finished = true; handler.removeCallbacksAndMessages(null); LocalSpeechStatus.update(detail); recognizer.destroy(); if (download === recognizer) download = null }
        handler.postDelayed({ finish("Android did not report the model download status. Check offline English in Voice input settings, then restart wake listening.") }, 60_000)
        try {
            LocalSpeechStatus.update("Requesting the offline English (United Kingdom) model. The download uses your internet connection.")
            recognizer.triggerModelDownload(speechIntent(), context.mainExecutor, object : ModelDownloadListener {
                override fun onProgress(completedPercent: Int) { if (!finished) LocalSpeechStatus.update("Downloading offline English model: ${completedPercent.coerceIn(0, 100)}%") }
                override fun onSuccess() = finish("Offline English model download completed. Restart wake listening to check it.")
                override fun onScheduled() = finish("Offline English model download scheduled by Android. Finish it in Voice input settings, then restart wake listening.")
                override fun onError(error: Int) = finish("Android could not download the local model (code $error). Use Voice input settings to install offline English, then restart wake listening.")
            })
        } catch (_: Exception) { finish("This Android recognizer cannot request its model download here. Use Voice input settings to install offline English.") }
    }
}

private class AndroidVoicePlayback(private val context: Context) : VoicePlayback {
    private val handler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var closed = false
    override val engine get() = tts?.defaultEngine.orEmpty()
    override fun initialize(onReady: (Boolean) -> Unit, onFinished: (String, Boolean) -> Unit) {
        tts = TextToSpeech(context) { status ->
            // Post even an immediate constructor callback until the field has been assigned.
            handler.post {
                if (!closed) {
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) = Unit
                        override fun onDone(id: String?) { handler.post { if (!closed && id != null) onFinished(id, true) } }
                        @Deprecated("Android legacy callback") override fun onError(id: String?) { handler.post { if (!closed && id != null) onFinished(id, false) } }
                    })
                    onReady(status == TextToSpeech.SUCCESS)
                }
            }
        }
    }
    override fun voices() = tts?.voices.orEmpty().map {
        InstalledVoice(it.name, it.locale.language, it.locale.country, it.isNetworkConnectionRequired,
            it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true)
    }
    override fun select(name: String): Boolean {
        val voice = tts?.voices?.find { it.name == name && !it.isNetworkConnectionRequired && it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true } ?: return false
        return tts?.setVoice(voice) == TextToSpeech.SUCCESS
    }
    override fun rate(value: Float) = tts?.setSpeechRate(value) == TextToSpeech.SUCCESS
    override fun speak(text: String, id: String) = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.SUCCESS
    override fun stop() { tts?.stop() }
    override fun close() { closed = true; handler.removeCallbacksAndMessages(null); tts?.shutdown(); tts = null }
}
