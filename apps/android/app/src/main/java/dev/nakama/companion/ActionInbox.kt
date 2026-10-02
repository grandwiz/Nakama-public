package dev.nakama.companion

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant

/** Persist before dispatch so a lost HTTP acknowledgement cannot place the same call twice. */
object ActionInbox {
    private val mutex = Mutex()
    suspend fun poll(context: Context, identity: HostIdentity, uiOnly: Boolean = false, timerOnly: Boolean = false, canExecute: (JSONObject) -> Boolean, execute: (JSONObject) -> ActionResult): List<ActionResult> = mutex.withLock {
        val client = HostClient(identity)
        val filter = if (uiOnly || timerOnly) "types" else "excludeTypes"
        val types = if (timerOnly) "timer_start" else "ui_read,ui_tap,ui_type,ui_scroll,ui_back"
        val actions = withContext(Dispatchers.IO) { client.request("GET", "/api/device/actions?$filter=$types").objects("actions") }
        val receipts = context.getSharedPreferences("action_receipts_${AttentionPolicy.scope(identity)}", Context.MODE_PRIVATE)
        val results = mutableListOf<ActionResult>()
        for (action in actions.take(20)) {
            if (PairingVault(context).load() != identity) break
            if (!DeviceDelivery.executesHere(action, identity.deviceId) || (timerOnly && action.optString("type") != "timer_start")) continue
            val id = action.optString("id")
            if (!id.matches(Regex("[A-Za-z0-9_-]{1,100}"))) continue
            val expiry = action.optString("expiresAt")
            if (expiry.isNotBlank() && runCatching { !Instant.parse(expiry).isAfter(Instant.now()) }.getOrDefault(true)) continue
            val prior = receipts.getString(id, null) ?: context.getSharedPreferences("action_receipts_${identity.deviceId}", Context.MODE_PRIVATE).getString(id, null)
            if (prior == null && !canExecute(action)) continue
            val result = if (prior != null) {
                val stored = JSONObject(prior)
                ActionResult.fromJson(stored)
            } else {
                val uncertain = ActionResult("interrupted", "The previous execution was interrupted. Check the phone before issuing a fresh request; this action will not be repeated automatically.")
                check(receipts.edit().putString(id, uncertain.json().toString()).commit()) { "Cannot safely record action receipt." }
                val outcome = withContext(Dispatchers.Main) {
                    if (PairingVault(context).load() != identity || !DeviceDelivery.executesHere(action, identity.deviceId)) ActionResult("blocked", "The device pairing changed before execution.")
                    else execute(action)
                }
                check(receipts.edit().putString(id, outcome.json().toString()).commit()) { "Cannot safely record the final action result. The action will not be repeated." }
                outcome
            }
            withContext(Dispatchers.IO) { client.request("POST", "/api/device/actions/$id/result", result.json()) }
            if (DeviceDelivery.addressedTo(action, identity.deviceId)) results += result
        }
        // Keep receipts for the lifetime of pairing. Their small size is preferable to duplicate calls.
        results
    }
}
