package dev.nakama.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Fake Android voice callbacks only: never opens a microphone or plays audio. */
@RunWith(AndroidJUnit4::class)
class WakeReplyPlaybackTest {
    private fun withVoice(test: suspend CoroutineScope.(VoiceController, FakeVoiceServices) -> Unit) = runBlocking {
        withContext(Dispatchers.Main) {
            val services = FakeVoiceServices()
            val output = VoiceController(services, MemoryVoicePreferences(), {}, {})
            try { test(output, services) } finally { output.close() }
        }
    }

    @Test fun missingCompletionTimesOutAndReleasesAudioBeforeNextWake() = withVoice { output, services ->
        output.speak("Synthetic reply with no completion callback")
        val pending = services.output.spoken.single().second
        val stops = services.output.stopped
        assertFalse(output.replyPlaybackAvailable)
        assertTrue(VoiceAudioGate.busy)
        awaitWakeReply(output, { true }, timeoutMillis = 20)
        assertEquals(stops + 1, services.output.stopped)
        assertTrue(output.replyPlaybackAvailable)
        assertFalse(VoiceAudioGate.busy)
        services.output.finished(pending, true)
        assertFalse("Late completion must not revive capture or hold the wake gate", VoiceAudioGate.busy)
        assertTrue(services.requests.isEmpty())
    }

    @Test fun cancellingConversationStopsPendingPlaybackAndPropagatesCancellation() = withVoice { output, services ->
        output.speak("Synthetic cancelled reply")
        val stops = services.output.stopped
        val pending = launch(start = CoroutineStart.UNDISPATCHED) { awaitWakeReply(output, { true }) }
        assertTrue(pending.isActive)
        pending.cancelAndJoin()
        assertTrue(pending.isCancelled)
        assertEquals(stops + 1, services.output.stopped)
        assertTrue(output.replyPlaybackAvailable)
        assertFalse(VoiceAudioGate.busy)
    }

    @Test fun losingCurrentSessionStopsReplyImmediately() = withVoice { output, services ->
        output.speak("Synthetic reply after its session ended")
        val stops = services.output.stopped
        awaitWakeReply(output, { false })
        assertEquals(stops + 1, services.output.stopped)
        assertTrue(output.replyPlaybackAvailable)
        assertFalse(VoiceAudioGate.busy)
    }

    @Test fun matchingCompletionFinishesWithoutStoppingACompletedVoice() = withVoice { output, services ->
        output.speak("Synthetic completed reply")
        val stops = services.output.stopped
        val pending = launch(start = CoroutineStart.UNDISPATCHED) { awaitWakeReply(output, { true }) }
        assertTrue(pending.isActive)
        services.output.finished(services.output.spoken.single().second, true)
        pending.join()
        assertFalse(pending.isCancelled)
        assertEquals(stops, services.output.stopped)
        assertTrue(output.replyPlaybackAvailable)
        assertFalse(VoiceAudioGate.busy)
    }
}
