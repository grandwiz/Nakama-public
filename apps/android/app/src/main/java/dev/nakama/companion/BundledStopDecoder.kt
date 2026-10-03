package dev.nakama.companion

/** A keyword candidate is verified from its bounded phrase audio before an exact Stop is emitted. */
internal class BundledStopDecoder(
    private val keywordFactory: () -> BundledKeywordDetector,
    private val confirm: (ShortArray) -> String,
) : BundledDecoder {
    private val recent = WakePcmWindow(64_000)
    private var detector = keywordFactory()
    private var candidate: ShortArray? = null
    private var closed = false
    override val speechStarted get() = false
    override val decodingRequired get() = candidate != null
    override fun accept(samples: ShortArray, count: Int): Boolean {
        check(!closed && candidate == null)
        recent.append(samples, count)
        val hit = detector.accept(samples, count) ?: return false
        if (hit.phrase != "Nakama stop") return false
        // Keep the request boundary after Nakama; the keyword graph supplies the name authority.
        val first = hit.requestBoundarySample ?: return false
        val captured = runCatching { recent.from(first.coerceAtLeast(0)) }.getOrNull() ?: return false
        if (captured.isEmpty()) return false
        candidate = captured
        return true
    }
    override fun result(): String {
        check(!closed)
        val captured = candidate ?: return ""
        candidate = null
        // KWS already supplied its acoustic look-ahead. Pad for stable short-phrase
        // decoding and finish immediately rather than waiting for the normal VAD endpoint.
        val phrase = captured.copyOf(captured.size + 3_072)
        captured.fill(0)
        return try {
            // Whisper may repeat the one short word; no additional vocabulary is accepted.
            if (confirm(phrase).trim().matches(Regex("stop(?:[\\s.!?]+stop){0,15}[.!?]*", RegexOption.IGNORE_CASE))) "Nakama stop" else ""
        } finally {
            phrase.fill(0); detector.close(); recent.clear(); detector = keywordFactory()
        }
    }
    override fun partial() = ""
    override fun finish() = "" // Cancellation never promotes an incomplete keyword.
    override fun close() { if (!closed) { closed = true; candidate?.fill(0); candidate = null; recent.clear(); detector.close() } }
}
