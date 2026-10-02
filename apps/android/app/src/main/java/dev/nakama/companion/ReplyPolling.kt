package dev.nakama.companion

/** Only this foreground chat's submitted tasks earn faster polling; shared history does not. */
class PendingReplies {
    private val started = linkedMapOf<String, Long>()
    val ids: Set<String> get() = started.keys.toSet()
    val oldestStartedAt: Long? get() = started.values.minOrNull()
    fun add(ids: List<String>, now: Long) {
        ids.filter { it.isNotBlank() }.take(32).forEach { started.putIfAbsent(it, now) }
        while (started.size > 64) started.remove(started.keys.first())
    }
    fun resolve(ids: Set<String>) { ids.forEach(started::remove) }
    fun clear() = started.clear()
}

object ReplyPolling {
    const val IDLE_MS = 4_500L
    fun unsuccessful(status: String) = status in setOf("failed", "stopped", "cancelled", "interrupted")
    fun finished(status: String) = status == "completed" || unsuccessful(status)
    /** Back off prolonged generations; no fast polling while backgrounded, offline or unauthorised. */
    fun delayMs(active: Boolean, startedAt: Long?, now: Long): Long {
        if (!active || startedAt == null) return IDLE_MS
        return when ((now - startedAt).coerceAtLeast(0)) {
            in 0 until 30_000 -> 750L
            in 30_000 until 120_000 -> 1_500L
            in 120_000 until 300_000 -> 3_000L
            else -> IDLE_MS
        }
    }
}
