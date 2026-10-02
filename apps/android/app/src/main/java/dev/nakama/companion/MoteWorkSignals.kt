package dev.nakama.companion

import android.os.SystemClock
import org.json.JSONObject

/** Shared by accepted foreground snapshots and the visible overlay's background refresh. */
object MoteWorkSignals {
    private val tracker = MoteWorkTracker(SystemClock::elapsedRealtime)
    fun permitted(identity: HostIdentity, snapshot: JSONObject): Boolean {
        val device = snapshot.objects("devices").find { it.optString("id") == identity.deviceId } ?: return false
        return device.optJSONObject("permissions")?.let { it.opt("googleAccess") != false && it.opt("projectAccess") != false } == true
    }
    @Synchronized fun updateHost(identity: HostIdentity, snapshot: JSONObject, requestStartedAt: Long = SystemClock.elapsedRealtime()): Boolean {
        val records = listOf("tasks", "projectWorkflows", "projectIntakes", "projectDeliveries", "autonomousTasks")
            .flatMap { key -> snapshot.objects(key).map { MoteWorkRecord(it.optString("status"), it.optString("stage")) } }
        return tracker.updateHost(AttentionPolicy.scope(identity), MoteWorkPolicy.classify(records, permitted(identity, snapshot)), requestStartedAt)
    }
    @Synchronized fun clearHost(identity: HostIdentity? = null, requestStartedAt: Long? = null): Boolean = tracker.clearHost(identity?.let(AttentionPolicy::scope), requestStartedAt)
    @Synchronized fun hasRecentHost(identity: HostIdentity): Boolean = tracker.hasRecentHost(AttentionPolicy.scope(identity))
    @Synchronized fun beginLocalWork(): Long = tracker.beginLocalWork()
    @Synchronized fun endLocalWork(token: Long) = tracker.endLocalWork(token)
    @Synchronized fun setVoiceState(source: String, state: MoteVoiceState) = tracker.setVoiceState(source, state)
    @Synchronized fun current(identity: HostIdentity?): MoteWorkState = tracker.state(identity?.let(AttentionPolicy::scope))
}
