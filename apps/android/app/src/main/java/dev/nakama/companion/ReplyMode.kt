package dev.nakama.companion

/** The input that submitted each request owns its reply mode, including delayed results. */
internal enum class ReplyMode { TEXT, VOICE }

internal object WakeCommandPolicy {
    fun fresh(capturedAt: Long, now: Long) = capturedAt > 0 && now >= capturedAt && now - capturedAt <= 30_000
}
