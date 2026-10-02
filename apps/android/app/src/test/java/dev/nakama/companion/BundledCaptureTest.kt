package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BundledCaptureTest {
    @Test fun captureProducerKeepsReadingWhileDecoderIsBusyWithoutDroppingFrames() {
        val produced = CountDownLatch(1)
        val released = CountDownLatch(1)
        var reads = 0
        val source = object : BundledAudio {
            override fun start() {}
            override fun read(samples: ShortArray): Int {
                if (reads == 20) { produced.countDown(); released.await(2, TimeUnit.SECONDS); return 0 }
                reads++; samples.fill(reads.toShort()); return samples.size
            }
            override fun stop() { released.countDown() }
            override fun close() { stop() }
        }
        val capture = BufferedBundledAudio(source, { Thread(it).start() }, 40_000)
        try {
            capture.start()
            assertTrue("A busy decoder must not block the microphone producer.", produced.await(2, TimeUnit.SECONDS))
            val output = ShortArray(1600)
            for (value in 1..20) {
                assertEquals(1600, capture.read(output))
                assertTrue("PCM order/contents must be retained.", output.all { it == value.toShort() })
            }
            capture.checkHealthy()
        } finally { capture.close() }
    }
    @Test fun overflowInvalidatesEntireQueueAndNeverReturnsPartialPcm() {
        val queue = BundledPcmQueue(4)
        assertTrue(queue.offer(shortArrayOf(1, 2, 3), 3))
        assertFalse(queue.offer(shortArrayOf(4, 5), 2))
        assertThrows(BundledCaptureOverflow::class.java) { queue.read(ShortArray(4)) }
        queue.stop()
        assertThrows(BundledCaptureOverflow::class.java) { queue.checkHealthy() }
    }
    @Test fun stopUnblocksConsumerAndThreadLaunchFailureReleasesAudio() {
        val queue = BundledPcmQueue(10); val entered = CountDownLatch(1); val done = CountDownLatch(1)
        Thread { entered.countDown(); assertEquals(0, queue.read(ShortArray(10))); done.countDown() }.start()
        assertTrue(entered.await(1, TimeUnit.SECONDS)); queue.stop()
        assertTrue(done.await(1, TimeUnit.SECONDS))
        var released = false
        val source = object : BundledAudio {
            override fun start() {}
            override fun read(samples: ShortArray) = 0
            override fun stop() {}
            override fun close() { released = true }
        }
        val capture = BufferedBundledAudio(source, { error("Synthetic thread launch failure") })
        assertThrows(IllegalStateException::class.java) { capture.start() }
        assertTrue(released)
    }
    @Test fun lateCaptureFailureDiscardsQueuedResultWithoutCrashingMainCallback() {
        for (error in listOf(BundledCaptureOverflow(), IllegalStateException("Synthetic read failed"), SecurityException())) {
            var failed = false
            val callbacks = ArrayDeque<() -> Unit>()
            val errors = mutableListOf<Int>(); val results = mutableListOf<String>()
            val audio = object : BundledAudio {
                override fun start() {}
                override fun read(samples: ShortArray): Int { samples.fill(10); return samples.size }
                override fun checkHealthy() { if (failed) throw error }
                override fun stop() {}
                override fun close() {}
            }
            val decoder = object : BundledDecoder {
                override fun accept(samples: ShortArray, count: Int) = true
                override fun result() = "set a ten minute timer"
                override fun partial() = ""
                override fun finish() = ""
                override fun close() {}
            }
            val session = BundledRecognitionSession(false, { decoder }, { audio }, { it() }, { callbacks.add(it) },
                { 0L }, {}, {}, results::add, {}, errors::add)
            session.start(); failed = true
            while (callbacks.isNotEmpty()) callbacks.removeFirst().invoke()
            assertTrue(results.isEmpty())
            assertEquals(listOf(when (error) {
                is BundledCaptureOverflow -> BundledSpeechError.CAPTURE_OVERFLOW
                is SecurityException -> BundledSpeechError.PERMISSION
                else -> BundledSpeechError.AUDIO_FAILURE
            }), errors)
        }
    }
    @Test fun overflowDuringSlowDecodeSuppressesAlreadyRecognizedCommand() {
        val queue = BundledPcmQueue(4)
        val errors = mutableListOf<Int>()
        val audio = object : BundledAudio {
            override fun start() {}
            override fun read(samples: ShortArray): Int { samples[0] = 1; return 1 }
            override fun checkHealthy() = queue.checkHealthy()
            override fun stop() = queue.stop()
            override fun close() = stop()
        }
        val decoder = object : BundledDecoder {
            override fun accept(samples: ShortArray, count: Int) = true
            override fun result(): String { queue.offer(ShortArray(5), 5); return "open Netflix" }
            override fun partial() = ""
            override fun finish() = ""
            override fun close() {}
        }
        BundledRecognitionSession(false, { decoder }, { audio }, { it() }, { it() }, { 0L }, {}, {},
            { fail("Overflow cannot submit a recognized prefix.") }, {}, errors::add).start()
        assertEquals(listOf(BundledSpeechError.CAPTURE_OVERFLOW), errors)
    }
}
class BundledUtteranceTest {
    private val voiced = ShortArray(512) { 1000 }
    private val quiet = ShortArray(512)
    @Test fun silenceAndShortClickNeverBecomeUtterancesAndMemoryRemainsBounded() {
        val utterance = BundledUtterance { if (it[0] > 0f) 1f else 0f }
        repeat(10_000) { assertFalse(utterance.accept(quiet, quiet.size)) }
        repeat(2) { assertFalse(utterance.accept(voiced, voiced.size)) }
        repeat(20) { assertFalse(utterance.accept(quiet, quiet.size)) }
        assertFalse(utterance.speechStarted); assertTrue(utterance.finish().isEmpty())
    }
    @Test fun realSpeechRetainsPrerollAndWaitsForEndSilence() {
        val utterance = BundledUtterance { if (it[0] > 0f) 1f else 0f }
        repeat(15) { utterance.accept(quiet, quiet.size) }
        repeat(12) { assertFalse(utterance.accept(voiced, voiced.size)) }
        assertTrue(utterance.speechStarted)
        repeat(18) { assertFalse(utterance.accept(quiet, quiet.size)) }
        assertTrue(utterance.accept(quiet, quiet.size))
        val samples = utterance.finish()
        assertTrue(samples.take(512).all { it == 0f })
        assertEquals(12 * 512, samples.count { it > 0f })
        assertEquals("Retain 192 ms after the final voiced frame.", 6 * 512, samples.size - samples.indexOfLast { it > 0f } - 1)
        assertFalse(utterance.speechStarted)
        samples.fill(0f)
    }
    @Test fun rejectedShortFragmentsCannotAccumulateOldSpeechOrOverflowTheIdleLead() {
        val utterance = BundledUtterance { if (it[0] > 0f) 1f else 0f }
        repeat(500) {
            repeat(7) { assertFalse(utterance.accept(voiced, voiced.size)) }
            repeat(8) { assertFalse(utterance.accept(quiet, quiet.size)) }
            assertFalse(utterance.speechStarted)
        }
        repeat(12) { utterance.accept(voiced, voiced.size) }
        repeat(19) { utterance.accept(quiet, quiet.size) }
        val samples = utterance.finish()
        assertTrue(samples.indexOfFirst { it > 0f } in 0..(5 * 512))
        assertEquals("No old fragments or lost first speech frame.", 12 * 512, samples.count { it > 0f })
        assertEquals(6 * 512, samples.size - samples.indexOfLast { it > 0f } - 1)
        samples.fill(0f)
    }
    @Test fun boundedLeadPreservesQuietConsonantImmediatelyBeforeSpeech() {
        val utterance = BundledUtterance { if (it[0] > 0.02f) 1f else 0f }
        repeat(30) { utterance.accept(quiet, quiet.size) }
        val consonant = ShortArray(512) { 200 }
        utterance.accept(consonant, consonant.size)
        repeat(12) { utterance.accept(voiced, voiced.size) }
        repeat(19) { utterance.accept(quiet, quiet.size) }
        val samples = utterance.finish()
        val onset = samples.indexOfFirst { it > 0.02f }
        assertTrue("Retain a bounded lead of at most160ms, not old wake residue.", onset in 1..(5 * 512))
        assertEquals("Quiet initial consonant audio must not be lost.", 512, samples.count { it == 200 / 32768f })
        assertEquals(12 * 512, samples.count { it > 0.02f })
        samples.fill(0f); consonant.fill(0)
    }
    @Test fun explicitFinishKeepsAllAudioIncludingAnUnconfirmedQuietTail() {
        val utterance = BundledUtterance { if (it[0] > 0f) 1f else 0f }
        repeat(12) { utterance.accept(voiced, voiced.size) }
        repeat(18) { assertFalse(utterance.accept(quiet, quiet.size)) }
        assertFalse(utterance.ready)
        val samples = utterance.finish()
        assertEquals(12 * 512, samples.count { it > 0f })
        assertEquals(18 * 512, samples.size - samples.indexOfLast { it > 0f } - 1)
        samples.fill(0f)
        assertTrue("The previous utterance must be zeroed/reset.", utterance.finish().isEmpty())
        repeat(12) { utterance.accept(voiced, voiced.size) }
        val partial = ShortArray(123) { 200 }
        assertFalse(utterance.accept(partial, partial.size))
        val manuallyFinished = utterance.finish()
        assertEquals(12 * 512 + 123, manuallyFinished.size)
        assertTrue(manuallyFinished.takeLast(123).all { it == 200 / 32768f })
        manuallyFinished.fill(0f); partial.fill(0)

    }
    @Test fun tailCroppingDoesNotLowerSpeechOnsetOrDiscardWeakInternalAudio() {
        var confidence = 0.4f
        val utterance = BundledUtterance { confidence }
        repeat(80) { assertFalse(utterance.accept(voiced, voiced.size)) }
        assertFalse(utterance.speechStarted)
        assertTrue(utterance.finish().isEmpty())
        confidence = 0.8f
        repeat(10) { utterance.accept(voiced, voiced.size) }
        confidence = 0.4f
        repeat(10) { assertFalse(utterance.accept(voiced, voiced.size)) }
        confidence = 0.8f
        repeat(10) { utterance.accept(voiced, voiced.size) }
        confidence = 0f
        repeat(19) { utterance.accept(quiet, quiet.size) }
        val samples = utterance.finish()
        assertEquals("Weak audio inside a request must remain whole.", 30 * 512, samples.count { it > 0f })
        assertEquals(6 * 512, samples.size - samples.indexOfLast { it > 0f } - 1)
        samples.fill(0f)
    }
    @Test fun overlongSpeechFailsRatherThanExecutingATruncatedCommand() {
        val utterance = BundledUtterance { 1f }
        assertThrows(BundledUtteranceTooLong::class.java) { repeat(700) { utterance.accept(voiced, voiced.size) } }
        utterance.reset(); assertFalse(utterance.speechStarted)
    }
}


class SpokenLocalClockGrammarTest {
    @Test fun ordinarySpokenPunctuationAndHyphenatedDurationsRemainLocal() {
        assertEquals(LocalClockCommand.Greeting, LocalClockCommands.parse("Hello, how are you?"))
        assertEquals(LocalClockCommand.Date, LocalClockCommands.parse("What is the date today?"))
        assertEquals(LocalClockCommand.CreateTimer(900), LocalClockCommands.parse("Start a 15-minute timer."))
        assertEquals(LocalClockCommand.CreateTimer(5400), LocalClockCommands.parse("Set a timer for 1 hour and 30 minutes."))
        assertNull(LocalClockCommands.parse("Do not set a 10-minute timer."))
        assertTrue(LocalClockCommands.parse("Set a -10-minute timer.") is LocalClockCommand.Invalid)
    }
}
