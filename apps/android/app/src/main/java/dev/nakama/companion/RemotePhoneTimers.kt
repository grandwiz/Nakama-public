package dev.nakama.companion

import android.content.Context
import org.json.JSONObject

/** Both the inbox and this timer-specific receipt survive reconnects; a duplicate never resets a deadline. */
internal object RemotePhoneTimers {
    fun key(identity: HostIdentity, origin: String, requestId: String) = AttentionPolicy.key(AttentionPolicy.scope(identity) + "|" + origin + "|" + requestId)
    // KTX edit(commit = true) discards the Boolean result; durable receipt failure must stop execution.
    @android.annotation.SuppressLint("UseKtx")
    @Synchronized fun execute(context: Context, identity: HostIdentity, action: JSONObject, create: ((Long, String, String) -> LocalTimer)? = null): ActionResult {
        require(DeviceDelivery.executesHere(action, identity.deviceId)) { "This timer is addressed to another device." }
        require(action.optString("type") == "timer_start")
        val args = action.optJSONObject("args") ?: error("Missing timer details.")
        val seconds = args.optLong("durationSeconds")
        val title = args.optString("title")
        val origin = action.optString("requestedBy")
        val requestId = args.optString("requestId").ifBlank { action.optString("id") }
        require(seconds in 1..604_800 && args.optDouble("durationSeconds") == seconds.toDouble() && title.length <= 80 && title.none(Char::isISOControl)) { "Invalid phone timer duration or title." }
        require(origin.isNotBlank() && requestId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "This timer needs its original device receipt." }
        val key = key(identity, origin, requestId)
        val preferences = context.getSharedPreferences("nakama_remote_timer_receipts", Context.MODE_PRIVATE)
        val fingerprint = AttentionPolicy.key(seconds.toString() + "|" + title)
        preferences.getString(key, null)?.let {
            val saved = JSONObject(it)
            check(saved.optString("commandFingerprint") == fingerprint) { "That timer receipt was already used with different details. No new timer was started." }
            return ActionResult.fromJson(saved)
        }
        val interrupted = ActionResult("interrupted", "Timer delivery was interrupted. Check Clock on the target device before sending a new request; this receipt will not restart it.")
        check(preferences.edit().putString(key, interrupted.json().put("commandFingerprint", fingerprint).toString()).commit()) { "Could not preserve the phone timer receipt." }
        val result = try {
            val timer = if (create != null) create(seconds, title, key) else LocalTimers.createRemote(context, seconds, title, key)
            ActionResult(if (timer.status == "running") "completed" else "needs_permission", LocalClockActions.result(timer).text,
                JSONObject().put("timerId", timer.id).put("status", timer.status).put("deviceId", identity.deviceId))
        } catch (error: Exception) { ActionResult("failed", error.message ?: "The target phone timer could not be saved.") }
        check(preferences.edit().putString(key, result.json().put("commandFingerprint", fingerprint).toString()).commit()) { "Could not preserve the final timer receipt. Check the target Clock; this request will not be repeated." }
        return result
    }
}
