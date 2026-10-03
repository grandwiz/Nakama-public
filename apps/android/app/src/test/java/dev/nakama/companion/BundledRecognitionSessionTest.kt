package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

private class SyntheticDecoder(private val segments: List<String?> = listOf("hello"), private val tail: String = "") : BundledDecoder {
    var accepts = 0; var finishes = 0; var closed = false
    override fun accept(samples: ShortArray, count: Int): Boolean { accepts++; return segments.getOrNull(accepts - 1) != null }
    override fun result() = segments[accepts - 1].orEmpty()
    override fun partial() = "Nakama provisional words"
    override fun finish(): String { finishes++; return tail }
    override fun close() { closed = true }
}
private class SyntheticMicrophone : BundledAudio {
    var started = false; var stopped = false; var closed = false; var reads = 0
    var clock = 0L
    var failStart = false
    var advance = 300L
    var onRead: (Int) -> Unit = {}
    var samples: ShortArray? = null
    override fun start() { if (failStart) throw SecurityException("Synthetic denied microphone"); started = true }
    override fun read(samples: ShortArray): Int {
        check(started); this.samples = samples; reads++; clock += advance
        samples.fill(123); onRead(reads); return samples.size
    }
    override fun stop() { stopped = true }
    override fun close() { stopped = true; closed = true }
}
class BundledRecognitionSessionTest {
    private fun session(continuous: Boolean, audio: SyntheticMicrophone, decoder: SyntheticDecoder,
        post: (() -> Unit) -> Unit = { it() }, worker: (() -> Unit) -> Unit = { it() },
        ready: () -> Unit = {}, ended: () -> Unit = {}, result: (String) -> Unit = {},
        partial: (String) -> Unit = {}, failure: (Int) -> Unit = { fail("Unexpected error $it") },
        decoderFactory: () -> BundledDecoder = { decoder }, audioFactory: () -> BundledAudio = { audio },
    ) = BundledRecognitionSession(continuous, decoderFactory, audioFactory, worker, post, { audio.clock }, ready, ended, result, partial, failure, {})

    @Test fun loadingDoesNotClaimReadinessAndTalkProducesOneFinalResult() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(listOf("Hello", "duplicate"))
        val workers = ArrayDeque<() -> Unit>(); val callbacks = ArrayDeque<() -> Unit>()
        val spoken = mutableListOf<String>(); var ready = 0; var ended = 0
        val input = session(false, audio, decoder, { callbacks += it }, { workers += it },
            ready = { assertTrue(audio.started); ready++ }, ended = { ended++ }, result = spoken::add)
        input.start(); input.start()
        assertEquals(1, workers.size); assertFalse(audio.started); assertEquals(0, ready)
        workers.removeFirst().invoke()
        assertTrue(audio.closed); assertTrue(decoder.closed); assertEquals(1, decoder.accepts)
        while (callbacks.isNotEmpty()) callbacks.removeFirst().invoke()
        assertEquals(1, ready); assertEquals(1, ended); assertEquals(listOf("Hello"), spoken)
        assertTrue(audio.samples!!.all { it == 0.toShort() })
    }
    @Test fun continuousSilenceAndFinalSegmentsKeepOneCaptureWithoutTimeoutOrRestart() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(listOf("", "ordinary background", "", "Nakama what time is it"))
        val results = mutableListOf<String>(); var ready = 0
        lateinit var input: BundledRecognitionSession
        audio.advance = 60_000; audio.onRead = { if (it == 5) input.close() }
        input = session(true, audio, decoder, ready = { ready++ }, result = results::add)
        input.start()
        assertEquals(1, ready); assertEquals(listOf("ordinary background", "Nakama what time is it"), results)
        assertEquals(4, decoder.accepts); assertEquals(0, decoder.finishes)
        assertTrue(audio.stopped); assertTrue(audio.closed); assertTrue(decoder.closed)
    }
    @Test fun rejectedContinuousCandidateReportsResumedWithoutSubmittingEmptyText() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(listOf("")); var resumed = 0
        lateinit var input: BundledRecognitionSession
        audio.onRead = { if (it == 2) input.close() }
        input = BundledRecognitionSession(true, { decoder }, { audio }, { it() }, { it() }, { audio.clock }, {}, {},
            { fail("Rejected candidate cannot submit") }, {}, { fail("Unexpected error") }, resumed = { resumed++ })
        input.start(); assertEquals(1, resumed)
    }
    @Test fun stopDropsQueuedPartialAndResultCallbacksRatherThanSubmittingThem() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(listOf(null), "PRIVATE PARTIAL")
        val callbacks = ArrayDeque<() -> Unit>(); val emitted = mutableListOf<String>()
        lateinit var input: BundledRecognitionSession
        audio.onRead = { if (it == 2) input.close() }
        input = session(true, audio, decoder, post = { callbacks += it }, ready = { emitted += "ready" }, result = emitted::add, partial = emitted::add)
        input.start()
        while (callbacks.isNotEmpty()) callbacks.removeFirst().invoke()
        assertTrue(emitted.isEmpty()); assertEquals(0, decoder.finishes); assertTrue(audio.stopped)
    }
    @Test fun cancellationDuringModelLoadingNeverStartsAMicrophoneAfterward() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(); var audioCreates = 0
        lateinit var input: BundledRecognitionSession
        input = session(false, audio, decoder, decoderFactory = { input.close(); decoder },
            audioFactory = { audioCreates++; audio }, ready = { fail("Cancelled load must not become ready") })
        input.start()
        assertEquals(0, audioCreates); assertFalse(audio.started); assertTrue(decoder.closed)
    }
    @Test fun explicitFinishFlushesOnceWhileCloseNeverFlushes() {
        val audio = SyntheticMicrophone(); val decoder = SyntheticDecoder(listOf(null), "what time is it")
        val results = mutableListOf<String>()
        lateinit var input: BundledRecognitionSession
        audio.onRead = { if (it == 2) input.stopListening() }
        input = session(false, audio, decoder, result = results::add)
        input.start()
        assertEquals(listOf("what time is it"), results); assertEquals(1, decoder.finishes)
        assertTrue(audio.stopped); assertTrue(audio.closed)
        input.close(); assertEquals(1, decoder.finishes)
    }
    @Test fun deniedMicrophoneAndFailedModelCannotClaimReadyOrProduceWords() {
        val audio = SyntheticMicrophone().apply { failStart = true }; val decoder = SyntheticDecoder()
        val errors = mutableListOf<Int>()
        session(false, audio, decoder, ready = { fail("Denied capture is not ready") }, result = { fail("Denied capture cannot submit") }, failure = errors::add).start()
        assertEquals(listOf(BundledSpeechError.PERMISSION), errors); assertTrue(audio.closed); assertTrue(decoder.closed)
        errors.clear()
        val unused = SyntheticMicrophone()
        session(false, unused, SyntheticDecoder(), failure = errors::add, decoderFactory = { error("Synthetic invalid model") }).start()
        assertEquals(listOf(BundledSpeechError.MODEL_UNAVAILABLE), errors); assertFalse(unused.started)
    }
    @Test fun talkSilenceHasABoundedTimeoutAndNoFakeTranscript() {
        val audio = SyntheticMicrophone().apply { advance = 30_001 }; val decoder = SyntheticDecoder(listOf(null), "")
        val errors = mutableListOf<Int>()
        session(false, audio, decoder, result = { fail("Silence cannot produce words") }, failure = errors::add).start()
        assertEquals(listOf(BundledSpeechError.NO_SPEECH), errors); assertEquals(1, audio.reads); assertTrue(audio.closed)
    }
    @Test fun stopUnblocksStartingOrReadingAudioWithoutWaitingForTheSessionMonitor() {
        for (blockAtStart in listOf(true, false)) {
            val entered = java.util.concurrent.CountDownLatch(1)
            val released = java.util.concurrent.CountDownLatch(1)
            val completed = java.util.concurrent.CountDownLatch(1)
            val timedOut = java.util.concurrent.atomic.AtomicBoolean()
            val events = java.util.Collections.synchronizedList(mutableListOf<String>())
            val decoder = SyntheticDecoder()
            val source = object : BundledAudio {
                fun block() {
                    entered.countDown()
                    if (!released.await(3, java.util.concurrent.TimeUnit.SECONDS)) timedOut.set(true)
                }
                override fun start() { if (blockAtStart) block() }
                override fun read(samples: ShortArray): Int { block(); return -1 }
                override fun stop() { released.countDown() }
                override fun close() { released.countDown() }
            }
            val input = BundledRecognitionSession(true, { decoder }, { source },
                { work -> Thread { try { work() } finally { completed.countDown() } }.start() },
                { it() }, { 0L }, { events += "ready" }, {}, { events += "result" }, {},
                { events += "error:$it" })
            input.start()
            assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS))
            input.close()
            assertTrue(completed.await(2, java.util.concurrent.TimeUnit.SECONDS))
            assertFalse("Stop must reach audio.stop while start/read is blocked.", timedOut.get())
            assertEquals(if (blockAtStart) emptyList<String>() else listOf("ready"), events.toList())
            assertTrue(decoder.closed)
        }
    }
    @Test fun closeBeforeStartDoesNotScheduleAnyWork() {
        val input = session(true, SyntheticMicrophone(), SyntheticDecoder(), worker = { fail("Closed constructor must not schedule model or microphone work") })
        input.close(); input.start()
    }
}
class BundledModelPolicyTest {
    private val hash = "a".repeat(64)
    @Test fun packagedModelManifestHasBoundedSafeUniquePathsAndHashes() {
        BundledModelPolicy.validate(BundledModelManifest("offline-english-1", listOf(BundledModelFile("encoder.int8.onnx", 1024, hash), BundledModelFile("data/tokens.txt", 12, hash))))
        for (path in listOf("../outside", "/absolute", "x/../../outside", "x\\outside", "C:outside", "x//file", "x/./file"))
            assertThrows(path, IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", listOf(BundledModelFile(path, 1, hash)))) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("../outside", listOf(BundledModelFile("file", 1, hash)))) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", listOf(BundledModelFile("file", 1, "not a hash")))) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", listOf(BundledModelFile("file", 1, hash), BundledModelFile("file", 2, hash)))) }
    }
    @Test fun oversizedOrUnboundedModelManifestsAreRejectedBeforeCopy() {
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", emptyList())) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", listOf(BundledModelFile("large", 256L * 1024 * 1024 + 1, hash)))) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", (1..3).map { BundledModelFile("large$it", 256L * 1024 * 1024, hash) })) }
        assertThrows(IllegalArgumentException::class.java) { BundledModelPolicy.validate(BundledModelManifest("safe", (1..1025).map { BundledModelFile("file$it", 1, hash) })) }
    }
}
