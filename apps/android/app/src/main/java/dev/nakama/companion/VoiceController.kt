package dev.nakama.companion

import android.content.Context
import android.speech.SpeechRecognizer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** All entry points and service callbacks run on Android's main thread. */
class VoiceController internal constructor(
    private val services: VoiceServices,
    private val preferences: VoicePreferenceStore,
    private val onText: (String) -> Unit,
    private val onState: (String) -> Unit,
) {
    constructor(context: Context, onText: (String) -> Unit, onState: (String) -> Unit) :
        this(AndroidVoiceServices(context), AndroidVoicePreferenceStore(context), onText, onState)

    private var saved = preferences.read()
    private var playback: VoicePlayback? = null
    private var recognizer: VoiceRecognition? = null
    private var closed = false
    private var engineGeneration = 0L
    private var recognitionGeneration = 0L
    private var utteranceGeneration = 0L
    private var activeUtterance: String? = null
    private var handsFree = false
    private var deferredSpeech: String? = null
    private val speechQueue = ArrayDeque<String>()
    var session: Long = 0L; private set
    var voices: List<InstalledVoice> by mutableStateOf(emptyList()); private set
    var selectedVoice: String by mutableStateOf(""); private set
    var engine: String by mutableStateOf(""); private set
    var ready by mutableStateOf(false); private set
    var engineStatus by mutableStateOf("Loading your Android voices…"); private set
    var activityStatus by mutableStateOf("Ready"); private set
    var rate by mutableStateOf(VoicePolicy.safeRate(saved.rate)); private set
    var allowSystemRecognition by mutableStateOf(saved.allowSystemRecognition); private set
    var recognitionMode by mutableStateOf(RecognitionMode.UNAVAILABLE); private set
    val replyPlaybackAvailable get() = ready && recognizer == null && activeUtterance == null

    init { refresh() }

    private fun state(message: String) { VoiceAudioGate.set(this, recognizer != null || activeUtterance != null || handsFree); activityStatus = message; onState(message) }
    private fun save() { preferences.write(saved) }
    private fun refreshRecognition() {
        recognitionMode = VoicePolicy.recognitionMode(
            runCatching { services.onDeviceRecognitionAvailable() }.getOrDefault(false),
            runCatching { services.systemRecognitionAvailable() }.getOrDefault(false),
            allowSystemRecognition,
        )
    }

    fun refresh() {
        if (closed) return
        stop()
        val generation = ++engineGeneration
        runCatching { playback?.close() }; playback = null
        ready = false; selectedVoice = ""; voices = emptyList(); engine = ""
        engineStatus = "Loading your Android voices…"
        refreshRecognition()
        try {
            val created = services.playback()
            playback = created
            created.initialize({ success ->
                if (!closed && generation == engineGeneration) {
                    if (!success) engineStatus = "Android speech could not start. Check speech settings, then refresh voices."
                    else runCatching {
                        engine = created.engine
                        voices = VoicePolicy.britishVoices(created.voices())
                        val chosen = VoicePolicy.choose(voices, engine, saved)
                        ready = chosen != null && created.select(chosen.name) && created.rate(rate)
                        selectedVoice = if (ready) chosen!!.name else ""
                        engineStatus = if (ready) "British English · offline voice selected" else "No usable offline British English voice. Add English (United Kingdom) voice data in Android speech settings, then refresh."
                    }.onFailure { engineStatus = "Could not read Android voices. Check speech settings, then refresh voices." }
                    val waiting = deferredSpeech; deferredSpeech = null
                    if (ready && waiting != null) speak(waiting)
                    else if (waiting != null) state(engineStatus)
                }
            }, { id, success ->
                if (!closed && generation == engineGeneration && id == activeUtterance) {
                    activeUtterance = null
                    if (!success) { handsFree = false; speechQueue.clear(); state("Voice playback failed. Check Android's speech settings.") }
                    else if (speechQueue.isNotEmpty()) speakNext()
                    else if (handsFree) listen(true) else state("Ready")
                }
            })
        } catch (_: Exception) { engineStatus = "Android speech could not start. Check speech settings, then refresh voices." }
    }

    fun selectVoice(name: String) {
        if (closed || voices.none { it.name == name && it.usableOffline }) return
        stop()
        if (runCatching { playback?.select(name) == true && playback?.rate(rate) == true }.getOrDefault(false)) {
            ready = true; selectedVoice = name
            saved = saved.copy(engine = engine, voice = name); save()
            engineStatus = "British English · offline voice selected"
        } else { ready = false; selectedVoice = ""; engineStatus = "That voice is unavailable. Refresh voices or check Android speech settings." }
    }

    fun changeRate(value: Float) {
        if (closed) return
        stop()
        val selected = VoicePolicy.safeRate(value)
        if (!ready || runCatching { playback?.rate(selected) == true }.getOrDefault(false)) {
            rate = selected; saved = saved.copy(rate = selected); save()
        } else state("Could not change the speaking speed. Refresh voices and try again.")
    }

    fun allowServiceRecognition(allowed: Boolean) {
        if (closed) return
        stop(); allowSystemRecognition = allowed
        saved = saved.copy(allowSystemRecognition = allowed); save(); refreshRecognition()
    }

    fun listen(continuous: Boolean = false) {
        if (closed) return
        stop(); refreshRecognition()
        if (recognitionMode !in listOf(RecognitionMode.ON_DEVICE, RecognitionMode.SYSTEM)) {
            state(recognitionMode.explanation); return
        }
        val generation = ++recognitionGeneration
        handsFree = continuous
        val onDevice = recognitionMode == RecognitionMode.ON_DEVICE
        val route = if (onDevice) "bundled offline English" else "Android service; may use internet"
        fun current() = !closed && generation == recognitionGeneration
        try {
            recognizer = services.recognition(onDevice,
                { if (current()) state("Listening · $route${if (handsFree) " · hands-free" else ""}") },
                { if (current()) state("Understanding · $route") },
                { text -> if (current()) {
                    // Terminal callbacks cannot submit twice or revive a stopped session.
                    ++recognitionGeneration
                    runCatching { recognizer?.close() }; recognizer = null
                    state(if (text.isBlank()) "No words detected. Tap Talk to try again." else "Ready")
                    if (text.isBlank()) handsFree = false else onText(text)
                } },
                { error -> if (current()) {
                    ++recognitionGeneration; handsFree = false
                    runCatching { recognizer?.close() }; recognizer = null
                    state(when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is needed. You can still type."
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Tap Talk to try again."
                        -200, -201, -202, -203, -204 -> "${LocalRecognitionPolicy.error(error)} No automatic service fallback was used."
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> if (onDevice) "Bundled English recognition is unavailable. Install a complete Nakama update. No automatic service fallback was used." else "English recognition is unavailable in the selected Android service. Check Android voice input settings. No automatic service fallback was used."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "The Android recognition service could not connect. You can still type."
                        else -> "Voice paused (Android code $error). Tap Talk to retry."
                    })
                } },
            )
            state("Starting microphone · $route")
            recognizer?.start()
        } catch (_: Exception) {
            stop(); state("Could not start speech recognition. Restart Nakama and check microphone permission and free storage. No automatic service fallback was used.")
        }
    }

    fun preview() { stop(); speak("Hello, I'm Nakama. What shall we make today?") }

    fun speak(text: String) {
        if (closed || text.isBlank()) return
        if (!ready || selectedVoice.isBlank()) {
            if (engineStatus.startsWith("Loading")) { deferredSpeech = text; state("Preparing your offline spoken reply…") }
            else { handsFree = false; state(engineStatus) }
            return
        }
        speechQueue.clear(); speechQueue.addAll(VoicePolicy.speechChunks(text))
        speakNext()
    }
    private fun speakNext() {
        val plain = speechQueue.removeFirstOrNull() ?: return
        // Recheck each chunk so missing voice data never selects a network default.
        val safe = runCatching { playback?.voices()?.any { it.name == selectedVoice && it.usableOffline && it.language.equals("en", true) && it.country.equals("GB", true) } == true && playback?.select(selectedVoice) == true }.getOrDefault(false)
        if (!safe) { stop(); ready = false; engineStatus = "The selected offline voice is no longer available. Refresh voices."; return }
        ++recognitionGeneration
        runCatching { recognizer?.close() }; recognizer = null
        val id = "nakama-${++utteranceGeneration}"
        activeUtterance = id
        state("Speaking · offline Android voice")
        if (!runCatching { playback?.speak(plain, id) == true }.getOrDefault(false)) {
            activeUtterance = null; handsFree = false; speechQueue.clear(); state("Voice playback failed. Check Android's speech settings.")
        }
    }

    fun pauseCapture() {
        handsFree = false; ++recognitionGeneration
        runCatching { recognizer?.close() }; recognizer = null
        state(if (activeUtterance != null) "Speaking - offline Android voice" else "Ready")
    }
    fun stop() {
        ++session
        deferredSpeech = null; speechQueue.clear()
        handsFree = false; ++recognitionGeneration; activeUtterance = null
        runCatching { recognizer?.close() }; recognizer = null
        runCatching { playback?.stop() }; state("Ready")
    }
    fun close() {
        if (closed) return
        closed = true; ++engineGeneration; stop()
        runCatching { playback?.close() }; playback = null; ready = false
    }
}
