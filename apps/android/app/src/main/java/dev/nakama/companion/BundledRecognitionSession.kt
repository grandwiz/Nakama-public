package dev.nakama.companion

/** Native decoding and microphone operations have one worker owner and an injectable test boundary. */
internal interface BundledDecoder {
    val speechStarted: Boolean get() = false
    val decodingRequired: Boolean get() = false
    fun accept(samples: ShortArray, count: Int): Boolean
    fun result(): String
    fun partial(): String
    fun finish(): String
    fun close()
}
internal interface BundledAudio {
    fun start()
    fun read(samples: ShortArray): Int
    fun checkHealthy() {}
    /** Must unblock read without waiting for the worker to join. */
    fun stop()
    fun close()
}
internal object BundledSpeechError {
    const val MODEL_UNAVAILABLE = -200
    const val ENGINE_FAILURE = -201
    const val AUDIO_FAILURE = -202
    const val CAPTURE_OVERFLOW = -203
    const val REQUEST_TOO_LONG = -204
    const val PERMISSION = 9
    const val NO_SPEECH = 6
}

/** Never saves microphone bytes or transcripts; cancellation never flushes a partial command. */
internal class BundledRecognitionSession(
    private val continuous: Boolean,
    private val decoderFactory: () -> BundledDecoder,
    private val audioFactory: () -> BundledAudio,
    private val worker: (() -> Unit) -> Unit,
    private val post: (() -> Unit) -> Unit,
    private val now: () -> Long,
    private val ready: () -> Unit,
    private val ended: () -> Unit,
    private val result: (String) -> Unit,
    private val partial: (String) -> Unit,
    private val failure: (Int) -> Unit,
    private val processing: () -> Unit = {},
    private val resumed: () -> Unit = {},
    private val idle: () -> Unit = { Thread.sleep(10) },
) {
    private val lock = Any()
    @Volatile private var closed = false
    @Volatile private var finishing = false
    private var started = false
    private var audio: BundledAudio? = null
    private var latestPartial = ""
    private var partialQueued = false
    fun start() {
        synchronized(lock) { if (closed || started) return; started = true }
        worker(::run)
    }
    fun stopListening() {
        val source = synchronized(lock) { finishing = true; audio }
        runCatching { source?.stop() }
    }
    fun close() {
        val source = synchronized(lock) { closed = true; latestPartial = ""; audio }
        runCatching { source?.stop() }
    }
    private fun deliver(callback: () -> Unit) { post { if (!closed) callback() } }
    private fun deliverPartial(text: String) {
        synchronized(lock) {
            if (closed || text == latestPartial) return
            latestPartial = text
            if (partialQueued) return
            partialQueued = true
        }
        post {
            val value = synchronized(lock) { partialQueued = false; latestPartial }
            if (!closed && value.isNotBlank()) partial(value)
        }
    }
    private fun finalText(text: String) {
        val bounded = text.trim().take(24_000)
        val capture = synchronized(lock) { audio }
        if (bounded.isNotBlank()) deliver {
            try { capture?.checkHealthy() }
            catch (_: BundledCaptureOverflow) { failure(BundledSpeechError.CAPTURE_OVERFLOW); return@deliver }
            catch (_: SecurityException) { failure(BundledSpeechError.PERMISSION); return@deliver }
            catch (_: Exception) { failure(BundledSpeechError.AUDIO_FAILURE); return@deliver }
            ended(); if (!closed) result(bounded)
        }
        else if (!continuous) deliver { failure(BundledSpeechError.NO_SPEECH) }
    }
    private fun run() {
        var decoder: BundledDecoder? = null
        var source: BundledAudio? = null
        val samples = ShortArray(1_600)
        var errorCode = BundledSpeechError.MODEL_UNAVAILABLE
        try {
            if (closed) return
            decoder = decoderFactory()
            if (closed) return
            errorCode = BundledSpeechError.AUDIO_FAILURE
            source = audioFactory()
            val canStart = synchronized(lock) {
                audio = source
                !closed && !finishing
            }
            // Platform initialization stays outside the session monitor so Stop can unblock it.
            // A source must honor stop before/during start; readiness is checked again afterward.
            if (canStart) source.start()
            if (closed) return
            if (!canStart || finishing) { errorCode = BundledSpeechError.ENGINE_FAILURE; finalText(decoder.finish().also { source.checkHealthy() }); return }
            deliver(ready)
            val began = now()
            var lastPartial = ""
            var partialAt = began
            var completed = false
            while (!closed && !finishing) {
                errorCode = BundledSpeechError.AUDIO_FAILURE
                val count = source.read(samples)
                if (closed || finishing) break
                check(count in 0..samples.size) { "Bundled microphone read failed." }
                if (count == 0) idle()
                else {
                    errorCode = BundledSpeechError.ENGINE_FAILURE
                    if (decoder.accept(samples, count)) {
                        if (decoder.decodingRequired) deliver(processing)
                        val text = decoder.result().trim().take(24_000)
                        source.checkHealthy()
                        samples.fill(0)
                        if (text.isNotBlank()) {
                            finalText(text)
                            if (!continuous) { completed = true; break }
                        } else if (continuous) deliver(resumed)
                        lastPartial = ""
                    } else if (now() - partialAt >= 200) {
                        partialAt = now()
                        val text = decoder.partial().trim().take(2_000)
                        if (text.isNotBlank() && text != lastPartial) { lastPartial = text; deliverPartial(text) }
                    }
                    samples.fill(0)
                }
                // Talk is bounded; continuous wake silence keeps the same capture/decoder alive.
                if (!continuous && now() - began >= 30_000) { finishing = true; break }
            }
            if (!closed && !completed) { errorCode = BundledSpeechError.ENGINE_FAILURE; finalText(decoder.finish().also { source.checkHealthy() }) }
        } catch (_: SecurityException) { if (!closed) deliver { failure(BundledSpeechError.PERMISSION) } }
        catch (_: BundledCaptureOverflow) { if (!closed) deliver { failure(BundledSpeechError.CAPTURE_OVERFLOW) } }
        catch (_: BundledUtteranceTooLong) { if (!closed) deliver { failure(BundledSpeechError.REQUEST_TOO_LONG) } }
        catch (_: Exception) { if (!closed) deliver { failure(errorCode) } }
        catch (_: LinkageError) { if (!closed) deliver { failure(BundledSpeechError.ENGINE_FAILURE) } }
        finally {
            samples.fill(0)
            synchronized(lock) { if (audio === source) audio = null; latestPartial = "" }
            runCatching { source?.close() }
            runCatching { decoder?.close() }
        }
    }
}
