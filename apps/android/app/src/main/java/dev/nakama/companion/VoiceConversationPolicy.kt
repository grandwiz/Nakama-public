package dev.nakama.companion

/** An explicit wake request grants one short follow-up window after a completed reply. */
internal class FollowUpWindow(private val now: () -> Long) {
    companion object { const val DURATION_MILLIS = 30_000L }
    private var until = 0L
    val active get() = until != 0L && now() < until
    fun renew() { until = now() + DURATION_MILLIS }
    fun clear() { until = 0L }
}

internal object StopCommandPolicy {
    fun matches(text: String) = text.trim().matches(Regex("(?:hey[ ,]+)?nakama[ ,]+stop[.!?]*", RegexOption.IGNORE_CASE))
    fun endsConversation(text: String) = text.trim().lowercase().trimEnd('.', '!', '?') in setOf("stop", "cancel", "never mind", "nevermind", "that is all", "that's all")
    // Avoid speaking our own interrupt keyword. The full original answer remains in chat.
    fun forPlayback(text: String) = text.replace(Regex("\\bnakama[\\s,]+stop\\b", RegexOption.IGNORE_CASE), "the stop phrase")
}

/** Main-thread-only registry: an interrupt stops every current reply, never future alarms. */
internal object VoiceOutputBus {
    private val outputs = linkedMapOf<Any, () -> Unit>()
    var onStop: (() -> Unit)? = null
    var onFollowUp: (() -> Unit)? = null
    fun set(owner: Any, active: Boolean, stop: () -> Unit) { if (active) outputs[owner] = stop else outputs.remove(owner) }
    fun stopAll() { val current = outputs.values.toList(); outputs.clear(); current.forEach { it() }; onStop?.invoke() }
}
