package dev.nakama.companion

/** Decorative activity is based on recorded work, never on permissions or an open browser. */
enum class MoteWorkState(val label: String, val description: String) {
    IDLE("Ready", "Nakama is ready"),
    WORKING("Working", "Nakama has active work in the latest status"),
    WAITING("Waiting", "Nakama is waiting for a result or your attention"),
    UNAVAILABLE("No update", "Nakama's work status is unavailable"),
    LISTENING("Listening", "Nakama is listening to your request"),
    SPEAKING("Speaking", "Nakama is speaking")
}
enum class MoteVoiceState { IDLE, LISTENING, SPEAKING }
data class MoteWorkRecord(val status: String, val stage: String = "")

object MoteWorkPolicy {
    private val waiting = setOf("queued", "pending", "waiting", "awaiting_answers", "awaiting_approval", "awaiting_check_approval", "awaiting_result", "needs_attention", "needs_user", "needs_permission", "held", "paused")
    private val terminal = setOf("completed", "failed", "stopped", "interrupted", "cancelled", "unavailable", "ready", "installed")
    fun classify(records: List<MoteWorkRecord>, allowed: Boolean): MoteWorkState {
        if (!allowed) return MoteWorkState.IDLE
        val states = records.map { record ->
            when {
                record.status in terminal -> MoteWorkState.IDLE
                record.status in waiting || record.stage in waiting -> MoteWorkState.WAITING
                record.status == "running" -> MoteWorkState.WORKING
                else -> MoteWorkState.IDLE
            }
        }
        return when {
            MoteWorkState.WORKING in states -> MoteWorkState.WORKING
            MoteWorkState.WAITING in states -> MoteWorkState.WAITING
            else -> MoteWorkState.IDLE
        }
    }
}

/** Only enums, timestamps and opaque scope keys survive a response. No prompts or screen contents. */
class MoteWorkTracker(private val now: () -> Long) {
    private var hostScope: String? = null
    private var hostState = MoteWorkState.UNAVAILABLE
    private var hostObservedAt = Long.MIN_VALUE
    private var acceptedAfter = Long.MIN_VALUE
    private var sequence = 0L
    private val localWork = mutableMapOf<Long, Long>()
    private val voices = mutableMapOf<String, Pair<MoteVoiceState, Long>>()

    fun updateHost(scope: String, state: MoteWorkState, requestStartedAt: Long): Boolean {
        if (requestStartedAt < acceptedAfter || requestStartedAt > now()) return false
        hostScope = scope; hostState = state; hostObservedAt = requestStartedAt; acceptedAfter = requestStartedAt
        return true
    }
    /** A delayed failure cannot erase a newer accepted snapshot or another pairing. */
    fun clearHost(scope: String? = null, requestStartedAt: Long? = null): Boolean {
        if (scope != null && hostScope != null && scope != hostScope) return false
        if (requestStartedAt != null && (requestStartedAt < acceptedAfter || requestStartedAt > now())) return false
        hostScope = null; hostState = MoteWorkState.UNAVAILABLE; hostObservedAt = Long.MIN_VALUE; acceptedAfter = now()
        return true
    }
    fun hasRecentHost(scope: String): Boolean = hostScope == scope && now() - hostObservedAt in 0..4_000
    fun beginLocalWork(): Long = (++sequence).also { localWork[it] = now() }
    fun endLocalWork(token: Long) { localWork.remove(token) }
    fun setVoiceState(source: String, state: MoteVoiceState) {
        if (state == MoteVoiceState.IDLE) voices.remove(source) else voices[source] = state to now()
    }
    fun state(scope: String?): MoteWorkState {
        val current = now()
        localWork.entries.removeAll { current - it.value !in 0..120_000 }
        voices.entries.removeAll { current - it.value.second !in 0..120_000 }
        if (voices.values.any { it.first == MoteVoiceState.SPEAKING }) return MoteWorkState.SPEAKING
        if (voices.values.any { it.first == MoteVoiceState.LISTENING }) return MoteWorkState.LISTENING
        if (localWork.isNotEmpty()) return MoteWorkState.WORKING
        if (scope == null) return MoteWorkState.IDLE
        if (hostScope != scope || current - hostObservedAt !in 0..20_000) return MoteWorkState.UNAVAILABLE
        return hostState
    }
}
