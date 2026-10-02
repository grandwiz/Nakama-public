package dev.nakama.companion

import android.content.Context
import android.os.SystemClock

internal object BundledWakeDecoders {
    fun open(context: Context): BundledDecoder = WakeRequestDecoder(
        keywordFactory = { BundledKeywordSpotters.open(context) },
        requestFactory = { BundledNativeDecoders.open(context) },
        now = SystemClock::elapsedRealtime,
    )
}

/** A wake event grants one bounded request; only the keyword model supplies wake authority. */
internal class WakeRequestDecoder(
    private val keywordFactory: () -> BundledKeywordDetector,
    private val requestFactory: () -> BundledDecoder,
    private val now: () -> Long,
    private val boundaryTailSamples: Long = 1_280L,
) : BundledDecoder {
    companion object {
        private const val WAIT_FOR_REQUEST_MILLIS = 15_000L
        private const val PRE_ROLL_SAMPLES = 32_000
    }
    private val recent = WakePcmWindow(PRE_ROLL_SAMPLES)
    private var keyword: BundledKeywordDetector? = keywordFactory()
    private var request: BundledDecoder? = null
    private var waitingSince = 0L
    private var pending = ""
    private var unannouncedWake = ""
    private var commandReady = false
    private var complete = false
    private var closed = false
    override val speechStarted get() = request?.speechStarted == true
    override val decodingRequired get() = commandReady && request?.decodingRequired == true

    override fun accept(samples: ShortArray, count: Int): Boolean {
        check(!closed && count in 0..samples.size)
        check(pending.isEmpty()) { "A wake result must be consumed before more audio." }
        if (complete) return false
        val active = request
        if (active != null) {
            val endpoint = active.accept(samples, count)
            if (endpoint) { commandReady = true; return true }
            if (!active.speechStarted && now() - waitingSince >= WAIT_FOR_REQUEST_MILLIS) rearm()
            return false
        }
        recent.append(samples, count)
        val detection = keyword?.accept(samples, count) ?: return false
        // Native timestamps include the stream's accumulated reset offset. Keep audio
        // already captured after the keyword, rather than cutting at callback time.
        val boundary = detection.lastTokenSample + boundaryTailSamples
        val seed = recent.from(boundary)
        keyword?.close(); keyword = null
        recent.clear()
        try {
            val next = requestFactory()
            request = next
            waitingSince = now()
            // At the keyword event, this seed contains only the small model look-ahead.
            // Later capture remains continuous while the command decoder handles VAD.
            commandReady = seed.isNotEmpty() && next.accept(seed, seed.size)
            unannouncedWake = detection.phrase
            if (!commandReady) pending = detection.phrase
            return true
        } finally { seed.fill(0) }
    }

    override fun result(): String {
        check(!closed)
        if (pending.isNotEmpty()) return pending.also { pending = ""; unannouncedWake = "" }
        if (!commandReady) return ""
        commandReady = false
        val active = request ?: return ""
        val text = active.result().trim()
        val authorized = if (text.isNotBlank()) authorized(text) else ""
        if (authorized.isNotBlank()) { complete = true; unannouncedWake = ""; active.close(); request = null; return authorized }
        return unannouncedWake.also { unannouncedWake = "" }
    }
    override fun partial(): String = "" // Unfinished ASR words never imply another wake event.
    override fun finish(): String {
        check(!closed)
        val active = request ?: return ""
        if (!active.speechStarted) return ""
        return active.finish().trim().takeIf(String::isNotBlank)?.let(::authorized).orEmpty()
    }
    override fun close() {
        if (!closed) {
            closed = true; pending = ""; unannouncedWake = ""; recent.clear()
            try { keyword?.close() } finally { keyword = null; request?.close(); request = null }
        }
    }
    private fun rearm() {
        request?.close(); request = null; recent.clear()
        keyword = keywordFactory(); waitingSince = 0L
    }
    private fun authorized(text: String): String {
        // Strip only the ordinary exact wake syntax if the user repeated it. No
        // replacement of similar names, phrases elsewhere, or uncertain ASR words.
        val command = FoundationPolicy.wakeCommand(text) ?: text
        return if (command.isBlank()) "" else "Nakama $command"
    }
}

/** Two seconds of volatile pre-roll; overwritten and zeroed on every handover/stop. */
internal class WakePcmWindow(private val capacity: Int) {
    private val samples = ShortArray(capacity)
    private var total = 0L
    init { require(capacity > 0) }
    fun append(values: ShortArray, count: Int) {
        require(count in 0..values.size)
        for (index in 0 until count) { samples[(total % capacity).toInt()] = values[index]; total++ }
    }
    fun from(first: Long): ShortArray {
        require(first >= maxOf(0L, total - capacity)) { "Wake processing fell behind microphone capture; repeat the request." }
        val start = first.coerceAtMost(total)
        return ShortArray((total - start).toInt()) { samples[((start + it) % capacity).toInt()] }
    }
    fun clear() { samples.fill(0); total = 0L }
}
