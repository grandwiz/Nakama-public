package dev.nakama.companion

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
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
internal interface VoiceRecognition { fun start(); fun close() }
internal interface VoiceServices {
    fun playback(): VoicePlayback
    fun onDeviceRecognitionAvailable(): Boolean
    fun systemRecognitionAvailable(): Boolean
    fun recognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition
}

/** Separate callback wiring can be exercised without opening a microphone or binding a service. */
internal fun recognitionCallbacks(onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onFailure: (Int) -> Unit) = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = onReady()
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(value: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = onEnd()
    override fun onError(error: Int) = onFailure(error)
    override fun onResults(results: Bundle?) = onResult(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
    override fun onPartialResults(results: Bundle?) = Unit
    override fun onEvent(type: Int, params: Bundle?) = Unit
}

internal class AndroidVoiceServices(private val context: Context) : VoiceServices {
    override fun playback(): VoicePlayback = AndroidVoicePlayback(context)
    override fun onDeviceRecognitionAvailable() = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    override fun systemRecognitionAvailable() = SpeechRecognizer.isRecognitionAvailable(context)
    override fun recognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition {
        val recognizer = if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        recognizer.setRecognitionListener(recognitionCallbacks(onReady, onEnd, onResult, onError))
        return object : VoiceRecognition {
            override fun start() {
                recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB").putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1))
            }
            override fun close() { try { recognizer.cancel() } finally { recognizer.destroy() } }
        }
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
