package dev.nakama.companion

/** A foreground-only launch request, consumed once and never persisted across recreation. */
class VoiceLaunchGate {
    private var pending = false
    private var permissionPending = false
    val awaitingPermissionResult: Boolean get() = permissionPending
    fun request() { pending = true }
    fun take(foreground: Boolean): Boolean {
        if (!foreground || !pending || permissionPending) return false
        pending = false
        return true
    }
    fun awaitingPermission() { permissionPending = true }
    fun permissionResult(granted: Boolean) {
        if (permissionPending) pending = granted
        permissionPending = false
    }
    fun pause() { if (!permissionPending) pending = false }
    fun cancel() { pending = false; permissionPending = false }
}

/** Late responses may only update the same connected, authorised pairing. */
data class UsageScope(val identity: HostIdentity?, val connected: Boolean, val allowed: Boolean)
data class UsageTicket(val scope: UsageScope, val generation: Long)
class UsageRequestGate {
    private var scope: UsageScope? = null
    private var generation = 0L
    private var inFlight = false
    fun update(value: UsageScope) { if (scope != value) { invalidate(); scope = value } }
    fun begin(): UsageTicket? {
        val current = scope ?: return null
        if (inFlight || current.identity == null || !current.connected || !current.allowed) return null
        inFlight = true
        return UsageTicket(current, ++generation)
    }
    fun accepts(ticket: UsageTicket) = inFlight && ticket.scope == scope && ticket.generation == generation
    fun finish(ticket: UsageTicket): Boolean {
        if (!accepts(ticket)) return false
        inFlight = false
        return true
    }
    fun invalidate() { generation++; inFlight = false }
}
