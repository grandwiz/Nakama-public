package dev.nakama.companion

import android.content.Context
import android.os.Bundle
import android.speech.SpeechRecognizer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

internal class MemoryVoicePreferences(var value: VoicePreferences = VoicePreferences()) : VoicePreferenceStore {
    override fun read() = value
    override fun write(preferences: VoicePreferences) { value = preferences }
}
internal class FakeVoicePlayback : VoicePlayback {
    override var engine = "fixture.engine"
    var available = listOf(InstalledVoice("British local A", "en", "GB", false), InstalledVoice("British local B", "en", "GB", false), InstalledVoice("British cloud", "en", "GB", true))
    var autoInitialize = true
    lateinit var ready: (Boolean) -> Unit
    lateinit var finished: (String, Boolean) -> Unit
    var chosen = ""
    var speed = 0f
    var stopped = 0
    var closed = false
    val spoken = mutableListOf<Pair<String, String>>()
    override fun initialize(onReady: (Boolean) -> Unit, onFinished: (String, Boolean) -> Unit) {
        ready = onReady; finished = onFinished; if (autoInitialize) onReady(true)
    }
    override fun voices() = available
    override fun select(name: String): Boolean { chosen = name; return true }
    override fun rate(value: Float): Boolean { speed = value; return true }
    override fun speak(text: String, id: String): Boolean { spoken.add(text to id); return true }
    override fun stop() { stopped++ }
    override fun close() { closed = true }
}
internal class FakeVoiceServices : VoiceServices {
    var output = FakeVoicePlayback()
    var onDevice = true
    var system = true
    var throwOnCreate = false
    var stopEnabled = false
    val stopRequests = mutableListOf<Request>()
    override fun stopRecognition(onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition? {
        if (!stopEnabled) return null
        val request = Request(true, onResult, onError).also(stopRequests::add)
        return object : VoiceRecognition { override fun start() {}; override fun close() { request.closed = true } }
    }
    data class Request(val onDevice: Boolean, val result: (String) -> Unit, val error: (Int) -> Unit, var closed: Boolean = false)
    val requests = mutableListOf<Request>()
    override fun playback() = output
    override fun onDeviceRecognitionAvailable() = onDevice
    override fun systemRecognitionAvailable() = system
    override fun recognition(onDevice: Boolean, onReady: () -> Unit, onEnd: () -> Unit, onResult: (String) -> Unit, onError: (Int) -> Unit): VoiceRecognition {
        if (throwOnCreate) throw UnsupportedOperationException("fixture")
        val request = Request(onDevice, onResult, onError).also(requests::add)
        return object : VoiceRecognition {
            override fun start() = onReady()
            override fun close() { request.closed = true }
        }
    }
}

@RunWith(AndroidJUnit4::class)
class VoiceControllerTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun main(block: () -> Unit) = instrumentation.runOnMainSync(block)

    @Test fun exactStopInterruptsAllReplyChunksAndCannotReviveFollowUp() = main {
        val services = FakeVoiceServices().apply { stopEnabled = true }
        val received = mutableListOf<String>(); var followUps = 0
        val controller = VoiceController(services, MemoryVoicePreferences(), received::add, {})
        VoiceOutputBus.onFollowUp = { followUps++ }
        try {
            controller.prepareWakeReply(); controller.speak("A long spoken answer. ".repeat(200))
            val detector = services.stopRequests.single()
            detector.result("Nakama stock"); assertTrue(controller.activityStatus.startsWith("Speaking"))
            detector.result("Nakama stop"); assertEquals("Ready", controller.activityStatus); assertTrue(detector.closed); assertFalse(VoiceAudioGate.busy)
            services.output.finished(services.output.spoken.last().second, true); detector.result("Nakama stop")
            assertEquals(0, followUps); assertEquals(1, services.output.spoken.size); assertTrue(received.isEmpty())
            controller.prepareWakeReply(); controller.speak("Say Nakama stop to interrupt.")
            assertFalse(services.output.spoken.last().first.contains("Nakama stop"))
            services.output.finished(services.output.spoken.last().second, true)
            assertEquals(1, followUps); assertTrue(services.stopRequests.last().closed)
        } finally { controller.close(); VoiceOutputBus.onFollowUp = null }
    }

    @Test fun explicitOfflineChoiceSpeedAndServiceOptInPersistWithoutPlayingOnChange() = main {
        val services = FakeVoiceServices()
        val store = MemoryVoicePreferences()
        val controller = VoiceController(services, store, {}, {})
        assertTrue(controller.ready)
        controller.selectVoice("British local B")
        controller.changeRate(0.85f)
        controller.allowServiceRecognition(true)
        assertEquals(VoicePreferences("fixture.engine", "British local B", 0.85f, true), store.value)
        assertTrue(services.output.spoken.isEmpty())
        controller.selectVoice("British cloud")
        assertEquals("British local B", controller.selectedVoice)
        controller.preview()
        assertEquals(1, services.output.spoken.size)
        assertEquals("Hello, I'm Nakama. What shall we make today?", services.output.spoken.single().first)
        controller.close()
        val second = VoiceController(FakeVoiceServices(), store, {}, {})
        assertEquals("British local B", second.selectedVoice)
        assertEquals(0.85f, second.rate, 0f)
        assertTrue(second.allowSystemRecognition)
        second.close()
    }

    @Test fun stopAndReplacementInvalidateRecognitionAndPlaybackCallbacks() = main {
        val services = FakeVoiceServices()
        val received = mutableListOf<String>()
        val controller = VoiceController(services, MemoryVoicePreferences(), received::add, {})
        controller.listen(true)
        val first = services.requests.single()
        assertTrue(first.onDevice)
        controller.stop()
        first.result("STOPPED RESULT MUST NOT SUBMIT")
        assertTrue(received.isEmpty())
        controller.listen(true)
        services.requests.last().result("one result")
        services.requests.last().result("duplicate")
        assertEquals(listOf("one result"), received)
        controller.speak("An answer")
        val oldId = services.output.spoken.last().second
        controller.preview()
        services.output.finished(oldId, true)
        services.output.finished(services.output.spoken.last().second, true)
        assertEquals("Preview must never restart the microphone", 2, services.requests.size)
        controller.listen()
        controller.close()
        services.requests.last().result("CLOSED RESULT MUST NOT SUBMIT")
        assertEquals(listOf("one result"), received)
    }

    @Test fun recognitionFallbackRequiresExplicitOptInAndFailuresDoNotSwitchServices() = main {
        val services = FakeVoiceServices().apply { onDevice = false }
        val controller = VoiceController(services, MemoryVoicePreferences(), {}, {})
        controller.listen()
        assertTrue(services.requests.isEmpty())
        assertTrue(controller.activityStatus.contains("You can type"))
        controller.allowServiceRecognition(true)
        controller.listen()
        assertFalse(services.requests.single().onDevice)
        services.onDevice = true
        controller.listen()
        assertTrue(services.requests.last().onDevice)
        services.requests.last().error(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
        assertEquals(2, services.requests.size)
        assertTrue(controller.activityStatus.contains("No automatic service fallback"))
        services.throwOnCreate = true
        controller.listen()
        assertEquals(2, services.requests.size)
        assertTrue(controller.activityStatus.contains("No automatic service fallback"))
        controller.close()
    }

    @Test fun missingOfflineVoiceAndLateEngineInitializationCannotPlayOrReviveOldEngine() = main {
        val services = FakeVoiceServices()
        val first = services.output.apply { autoInitialize = false }
        val controller = VoiceController(services, MemoryVoicePreferences(), {}, {})
        services.output = FakeVoicePlayback().apply { available = available.filter { it.needsNetwork } }
        controller.refresh()
        first.ready(true)
        assertFalse(controller.ready)
        assertTrue(controller.engineStatus.contains("No usable offline British English"))
        controller.preview()
        assertTrue(first.spoken.isEmpty() && services.output.spoken.isEmpty())
        services.output = FakeVoicePlayback()
        controller.refresh()
        assertTrue(controller.ready)
        services.output.available = services.output.available.map { it.copy(needsNetwork = true) }
        controller.speak("Must not reach online engine")
        assertFalse(controller.ready)
        assertTrue(services.output.spoken.isEmpty())
        controller.close()
        services.output.ready(true)
        assertFalse(controller.ready)
    }

    @Test fun preferencesRoundTripAcrossAndroidStoreInstancesWithoutChangingAppPreferences() {
        val context = instrumentation.targetContext
        val name = "voice-test-${System.nanoTime()}"
        try {
            val first = AndroidVoicePreferenceStore(context, name)
            assertEquals(VoicePreferences(), first.read())
            val saved = VoicePreferences("fixture.engine", "British local B", 1.15f, true)
            first.write(saved)
            assertEquals(saved, AndroidVoicePreferenceStore(context, name).read())
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().putFloat("voiceRate", Float.NaN).commit()
            assertEquals(1f, first.read().rate, 0f)
        } finally { context.deleteSharedPreferences(name) }
    }

    @Test fun platformListenerRoutesSyntheticErrorsAndResultsWithoutOpeningMicrophone() {
        var ready = 0; var ended = 0
        val errors = mutableListOf<Int>(); val texts = mutableListOf<String>()
        val listener = recognitionCallbacks({ ready++ }, { ended++ }, texts::add, errors::add)
        listener.onReadyForSpeech(Bundle())
        listener.onEndOfSpeech()
        listener.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
        listener.onResults(Bundle().apply { putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf("expected text", "ignored alternate")) })
        listener.onResults(null)
        assertEquals(1, ready); assertEquals(1, ended)
        assertEquals(listOf(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE), errors)
        assertEquals(listOf("expected text", ""), texts)
    }

    @Test fun pendingReplyClosesMicrophoneAndOnlyItsMatchingCompletionMayResumeHandsFree() = main {
        val services = FakeVoiceServices(); val received = mutableListOf<String>()
        val controller = VoiceController(services, MemoryVoicePreferences(), received::add, {})
        controller.listen(true)
        val first = services.requests.single()
        controller.speak("Late earlier reply")
        assertTrue(first.closed)
        first.result("Speech from Nakama must not submit")
        assertTrue(received.isEmpty())
        val firstId = services.output.spoken.last().second
        controller.speak("Newer team reply")
        services.output.finished(firstId, true)
        assertEquals(1, services.requests.size)
        services.output.finished(services.output.spoken.last().second, true)
        assertEquals(2, services.requests.size)
        services.requests.last().result("Owner's next turn")
        assertEquals(listOf("Owner's next turn"), received)
        controller.listen(false)
        controller.speak("Another pending reply")
        services.output.finished(services.output.spoken.last().second, true)
        assertEquals("Single-turn Talk must not become hands-free", 3, services.requests.size)
        controller.close()
    }
    @Test fun replyWaitsForOfflineInitializationAndStopDiscardsDeferredPlayback() = main {
        val services = FakeVoiceServices().apply { output.autoInitialize = false }
        val controller = VoiceController(services, MemoryVoicePreferences(), {}, {})
        controller.speak("Reply before the offline engine starts")
        assertTrue(services.output.spoken.isEmpty())
        services.output.ready(true)
        assertEquals("Reply before the offline engine starts", services.output.spoken.single().first)
        controller.close()
        val stoppedServices = FakeVoiceServices().apply { output.autoInitialize = false }
        val stopped = VoiceController(stoppedServices, MemoryVoicePreferences(), {}, {})
        stopped.speak("Stopped reply"); stopped.stop(); stoppedServices.output.ready(true)
        assertTrue(stoppedServices.output.spoken.isEmpty()); stopped.close()
    }
    @Test fun longAnswerSpeaksAllChunksAndPausingCaptureDoesNotCutOffSpeech() = main {
        val services = FakeVoiceServices(); val controller = VoiceController(services, MemoryVoicePreferences(), {}, {})
        val recipe = (1..650).joinToString(" ") { "Step $it: stir." }
        val expected = VoicePolicy.speechChunks(recipe)
        controller.listen(true); controller.speak(recipe); controller.pauseCapture()
        for (index in expected.indices) {
            assertEquals(expected[index], services.output.spoken[index].first)
            services.output.finished(services.output.spoken[index].second, true)
        }
        assertEquals(expected.size, services.output.spoken.size)
        assertEquals("Background pause cannot restart the microphone", 1, services.requests.size)
        assertTrue(controller.replyPlaybackAvailable); controller.close()
    }

    @Test fun segmentedCallbackWiringKeepsPartialTextSeparateFromCompletedSegments() {
        val partials = mutableListOf<String>(); val segments = mutableListOf<String>(); val finals = mutableListOf<String>(); var ended = 0
        val listener = recognitionCallbacks({}, {}, finals::add, {}, partials::add, segments::add, { ended++ })
        fun result(text: String) = Bundle().apply { putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf(text)) }
        listener.onPartialResults(result("Nakama send"))
        assertEquals(listOf("Nakama send"), partials); assertTrue(segments.isEmpty()); assertTrue(finals.isEmpty())
        listener.onSegmentResults(result("Nakama what time is it"))
        assertEquals(listOf("Nakama what time is it"), segments); assertTrue(finals.isEmpty())
        listener.onEndOfSegmentedSession(); assertEquals(1, ended)
    }
    @Test fun continuousIntentUsesOnlyTheEphemeralPcmPipeAndClosesWithoutOpeningAMicrophone() = main {
        val source = LocalPcmSource { fail("No microphone or audio thread was started") }
        val descriptor = source.descriptor.fileDescriptor
        val intent = speechIntent("en-US", source.descriptor)
        assertEquals("en-US", intent.getStringExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE))
        assertEquals(android.speech.RecognizerIntent.EXTRA_AUDIO_SOURCE, intent.getStringExtra(android.speech.RecognizerIntent.EXTRA_SEGMENTED_SESSION))
        assertEquals(16_000, intent.getIntExtra(android.speech.RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 0))
        assertTrue(intent.getBooleanExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, false))
        assertTrue(intent.getBooleanExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, false))
        assertTrue(descriptor.valid()); source.close(); source.close(); assertFalse(descriptor.valid())
        assertFalse(speechIntent().hasExtra(android.speech.RecognizerIntent.EXTRA_AUDIO_SOURCE))
    }

    @Test fun bundledTalkWorksWithoutSystemRecognitionAndModelFailureNeverUsesService() = main {
        val services = FakeVoiceServices().apply { onDevice = true; system = false }
        val received = mutableListOf<String>()
        val controller = VoiceController(services, MemoryVoicePreferences(VoicePreferences(allowSystemRecognition = true)), received::add, {})
        assertEquals(RecognitionMode.ON_DEVICE, controller.recognitionMode)
        controller.listen(); assertTrue(services.requests.single().onDevice)
        services.requests.single().error(-201)
        assertTrue(controller.activityStatus.contains("Bundled speech"))
        assertTrue(controller.activityStatus.contains("No automatic service fallback"))
        assertEquals(1, services.requests.size); assertTrue(services.requests.single().closed)
        services.requests.single().result("stale failed model callback"); assertTrue(received.isEmpty())
        controller.close()
    }
    @Test fun productionTalkAndWakeFactoriesUseBundledAdapterWithoutPlatformRecognizer() = main {
        val context = instrumentation.targetContext
        val services = AndroidVoiceServices(context, platformRecognitionAvailable = { false })
        assertFalse(services.systemRecognitionAvailable())
        assertTrue("The release APK must contain its offline model manifest", services.onDeviceRecognitionAvailable())
        val talk = services.recognition(true, { fail("No microphone started") }, {}, {}, {})
        val wake = services.wakeRecognition({}, {})
        try {
            assertTrue(talk is BundledSpeechRecognition); assertFalse(talk.continuousSession)
            assertTrue(wake is BundledSpeechRecognition); assertTrue(wake.continuousSession)
            assertEquals(60_000L, wake.startupTimeoutMillis)
        } finally { talk.close(); wake.close() }
    }

}
