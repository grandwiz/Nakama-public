package dev.nakama.companion

import org.json.JSONObject

data class AlarmRequestReceipt(val id: String, val updatedAt: String)
data class AlarmFeedback(val text: String, val needsSetup: Boolean = false)

/** Only the accepted request's origin and exact alarm version can produce local feedback. */
object AlarmReceiptPolicy {
    fun request(response: JSONObject, deviceId: String): AlarmRequestReceipt? {
        if (!DeviceDelivery.addressedTo(response, deviceId)) return null
        val outcome = response.optJSONObject("outcome") ?: return null
        if (outcome.optString("type") != "routine_created" || outcome.optString("kind") != "alarm" || deviceId !in DeviceDelivery.alarmTargets(outcome)) return null
        val id = outcome.optString("id"); val version = outcome.optString("updatedAt")
        return if (id.isBlank() || version.isBlank()) null else AlarmRequestReceipt(id, version)
    }
    fun feedback(request: AlarmRequestReceipt, deviceId: String, routines: List<JSONObject>, enabled: Boolean, receipt: JSONObject?): AlarmFeedback? {
        val routine = routines.firstOrNull { it.optString("id") == request.id && it.optString("updatedAt") == request.updatedAt && it.optString("kind") == "alarm" && deviceId in DeviceDelivery.alarmTargets(it) } ?: return null
        if (!routine.optBoolean("enabled")) return null
        if (!enabled) return AlarmFeedback("To let Nakama ring on this device, enable Sync phone alarms in Routines and allow notifications and Alarms & reminders. This alarm is saved on your PC; it is not yet scheduled here.", true)
        if (receipt?.optString("expectedUpdatedAt") != request.updatedAt) return AlarmFeedback("Your alarm is saved on your PC, but this device has not confirmed scheduling. Open Routines to check and sync it.", true)
        return when (receipt.optString("status")) {
            "scheduled" -> AlarmFeedback("This device registered the alarm with Android. Alarm volume and Do Not Disturb still apply.")
            "permission_required", "failed" -> AlarmFeedback("This device could not schedule the alarm: " + receipt.optString("detail") + " Open Routines to finish setup.", true)
            else -> AlarmFeedback(receipt.optString("detail"))
        }
    }
}
