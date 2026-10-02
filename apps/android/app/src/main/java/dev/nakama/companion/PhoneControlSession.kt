package dev.nakama.companion

/** Monotonic, in-memory consent. A new session never inherits an in-flight poll's authority. */
class PhoneControlSession(private val now: () -> Long) {
    private var generation = 0L
    private var expiresAt = 0L
    var packageName = ""; private set
    val remainingSeconds: Int get() = ((expiresAt - now()).coerceAtLeast(0) + 999).div(1000).toInt()
    val token: Long? get() = generation.takeIf { packageName.isNotBlank() && now() < expiresAt }

    fun start(target: String): Long {
        require(target.isNotBlank())
        generation++
        packageName = target
        expiresAt = now() + 120_000
        return generation
    }

    fun allows(capturedToken: Long?, target: String): Boolean =
        capturedToken != null && capturedToken == token && target == packageName

    fun stop() { generation++; packageName = ""; expiresAt = 0 }
}
