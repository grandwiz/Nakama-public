package dev.nakama.companion

import android.app.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import org.json.JSONObject
import java.time.Instant

object PhoneAlarmScheduler {
    private const val PREFS = "nakama_phone_alarms"
    fun enabled(context: Context, deviceId: String) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).let { it.getBoolean("syncEnabled", false) && it.getString("deviceId", "") == deviceId }
    fun enable(context: Context, deviceId: String) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("syncEnabled", true).putString("deviceId", deviceId).apply() }
    fun silence(context: Context) { AlarmPlaybackService.stop(context); JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("routines", "{}").orEmpty()).keys().forEach { context.getSystemService(NotificationManager::class.java).cancel(it, 92) } }
    private fun pending(context: Context, id: String, action: String = "FIRE", version: String? = null) = PendingIntent.getBroadcast(context, 0,
        Intent(context, PhoneAlarmReceiver::class.java).setAction(action).setData(Uri.parse("nakama://alarm/${Uri.encode(id)}")).putExtra("routine_id", id).putExtra("routine_version", version), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun scheduledDate(routine: JSONObject): String? = routine.opt("scheduledDate").takeUnless { it == null || it == JSONObject.NULL }?.toString()
    fun revision(context: Context, routines: List<JSONObject>): String = routines.joinToString("|") { it.optString("id") + ":" + it.optString("updatedAt") } +
        ":" + context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms() + ":" + context.getSystemService(NotificationManager::class.java).areNotificationsEnabled() + ":" + context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("restoreGeneration", 0)
    fun feedback(context: Context, deviceId: String, request: AlarmRequestReceipt, routines: List<JSONObject>): AlarmFeedback? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val receipt = if (preferences.getString("deviceId", "") == deviceId) JSONObject(preferences.getString("receipts", "{}").orEmpty()).optJSONObject(request.id) else null
        return AlarmReceiptPolicy.feedback(request, deviceId, routines, enabled(context, deviceId), receipt)
    }
    private fun next(routine: JSONObject): Instant? {
        val days = routine.optJSONArray("weekdays")
        return FoundationPolicy.nextAlarm(routine.optString("time"), if (days == null) emptySet() else (0 until days.length()).map { days.optInt(it, -1) }.toSet(), routine.optString("timeZone"), Instant.now(), scheduledDate(routine))
    }
    private fun schedule(context: Context, routine: JSONObject): Instant {
        val manager = context.getSystemService(AlarmManager::class.java)
        check(manager.canScheduleExactAlarms()) { "Allow Alarms & reminders in Android settings, then sync again." }
        check(context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { "Allow Nakama notifications, then sync again." }
        val soundId = routine.alarmSoundId()
        if (soundId.isNotBlank()) check(PairingVault(context).load()?.let { HostAlarmSounds.file(context, it, soundId) } != null) { "The selected custom alarm sound must finish downloading and verify before this alarm can be scheduled." }
        val at = next(routine) ?: error("The alarm needs a future date or repeat weekday, valid time and timezone.")
        val show = PendingIntent.getActivity(context, 91, Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Routines"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.setAlarmClock(AlarmManager.AlarmClockInfo(at.toEpochMilli(), show), pending(context, routine.getString("id"), version = routine.optString("updatedAt")))
        return at
    }
    fun sync(context: Context, deviceId: String, routines: List<JSONObject>): List<JSONObject> {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = JSONObject(preferences.getString("routines", "{}").orEmpty())
        val selected = routines.filter { it.optString("kind") == "alarm" && deviceId in DeviceDelivery.alarmTargets(it) }
        val ids = selected.map { it.optString("id") }.toSet()
        old.keys().asSequence().filter { it !in ids }.forEach { AlarmPlaybackService.stop(context, it); context.getSystemService(AlarmManager::class.java).cancel(pending(context, it)); context.getSystemService(NotificationManager::class.java).cancel(it, 92) }
        val saved = JSONObject()
        val localReceipts = JSONObject()
        val previousReceipts = JSONObject(preferences.getString("receipts", "{}").orEmpty())
        val permissions = context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms() && context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        val fired = JSONObject(preferences.getString("fired", "{}").orEmpty())
        fired.keys().asSequence().toList().filter { it !in ids }.forEach { fired.remove(it) }
        val results = selected.map { routine ->
            val id = routine.getString("id")
            val version = routine.optString("updatedAt")
            val previousReceipt = previousReceipts.optJSONObject(id)
            if (old.optJSONObject(id)?.optString("updatedAt")?.let { it != version } == true) { AlarmPlaybackService.stop(context, id); context.getSystemService(NotificationManager::class.java).cancel(id, 92) }
            val consumed = scheduledDate(routine) != null && fired.optString(id).let { it.isNotBlank() && it == version }
            if (AlarmRegistrationPolicy.preserve(version, old.optJSONObject(id)?.optString("updatedAt"), previousReceipt?.optString("expectedUpdatedAt"), previousReceipt?.optString("status"), routine.optBoolean("enabled"), permissions, consumed)) {
                // Keep the registered occurrence even if its due instant passed during this refresh.
                saved.put(id, routine)
                val retained = JSONObject(previousReceipt!!.toString()).put("routineId", id)
                localReceipts.put(id, JSONObject(retained.toString()))
                return@map retained
            }
            context.getSystemService(AlarmManager::class.java).cancel(pending(context, id))
            val receipt = JSONObject().put("routineId", id).put("expectedUpdatedAt", version)
            if (!routine.optBoolean("enabled")) { AlarmPlaybackService.stop(context, id); context.getSystemService(NotificationManager::class.java).cancel(id, 92); receipt.put("status", "cancelled").put("detail", "This phone's alarm was cancelled.") }
            else if (scheduledDate(routine) != null && (consumed || next(routine) == null)) {
                saved.put(id, routine) // Retain it so Stop/clear still silences an already ringing notification.
                receipt.put("status", "cancelled").put("detail", "This one-time alarm occurrence has ended. It will not repeat.")
            } else {
                saved.put(id, routine)
                try { val at = schedule(context, routine); receipt.put("status", "scheduled").put("detail", "Registered with Android AlarmManager for $at. Sound depends on Android's alarm volume, notification channel and Do Not Disturb settings.") }
                catch (failure: Exception) { receipt.put("status", if (!context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms() || !context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) "permission_required" else "failed").put("detail", failure.message.orEmpty()) }
            }
            localReceipts.put(id, JSONObject(receipt.toString()))
            receipt
        }
        preferences.edit().putString("routines", saved.toString()).putString("receipts", localReceipts.toString()).putString("fired", fired.toString()).putString("deviceId", deviceId).apply()
        return results
    }
    fun clear(context: Context) {
        AlarmPlaybackService.stop(context)
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = JSONObject(preferences.getString("routines", "{}").orEmpty())
        saved.keys().forEach { context.getSystemService(AlarmManager::class.java).cancel(pending(context, it)); context.getSystemService(NotificationManager::class.java).cancel(it, 92) }
        preferences.edit().clear().apply()
    }
    internal fun playbackAuthorized(context: Context, id: String, expectedVersion: String, soundId: String): Boolean {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val identity = PairingVault(context).load() ?: return false
        val routine = JSONObject(preferences.getString("routines", "{}").orEmpty()).optJSONObject(id) ?: return false
        return enabled(context, identity.deviceId) && routine.optBoolean("enabled") && identity.deviceId in DeviceDelivery.alarmTargets(routine) && routine.optString("updatedAt") == expectedVersion && routine.alarmSoundId() == soundId
    }
    fun fire(context: Context, id: String, expectedVersion: String? = null) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (PairingVault(context).load()?.deviceId != preferences.getString("deviceId", "")) { clear(context); return }
        val routine = JSONObject(preferences.getString("routines", "{}").orEmpty()).optJSONObject(id) ?: return
        if (!routine.optBoolean("enabled") || preferences.getString("deviceId", "") !in DeviceDelivery.alarmTargets(routine)) return
        if (expectedVersion != null && expectedVersion != routine.optString("updatedAt")) return
        if (scheduledDate(routine) != null) {
            val fired = JSONObject(preferences.getString("fired", "{}").orEmpty())
            val version = routine.optString("updatedAt")
            if (version.isBlank() || fired.optString(id) == version) return
            // Persist consumption before notification, including across a clock rollback or reboot.
            if (!preferences.edit().putString("fired", fired.put(id, version).toString()).commit()) return
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        val soundId = routine.alarmSoundId()
        val custom = soundId.isNotBlank() && PairingVault(context).load()?.let { HostAlarmSounds.file(context, it, soundId) } != null && AlarmPlaybackService.start(context, id, routine.optString("updatedAt"), soundId, routine.optString("title", "Nakama alarm"))
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
        manager.createNotificationChannel(NotificationChannel("nakama_routine_alarms", "Nakama routine alarms", NotificationManager.IMPORTANCE_HIGH).apply { setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attributes) })
        if (custom) manager.createNotificationChannel(NotificationChannel("nakama_custom_routine_alarms", "Custom routine alarm notices", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) })
        val stop = pending(context, id, "STOP")
        val open = PendingIntent.getActivity(context, 91, Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Routines"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, if (custom) "nakama_custom_routine_alarms" else "nakama_routine_alarms").setSmallIcon(R.drawable.ic_nakama).setContentTitle(routine.optString("title", "Nakama alarm")).setContentText("Routine alarm · tap Stop to silence").setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setDeleteIntent(stop).addAction(Notification.Action.Builder(null, "Stop alarm", stop).build()).setAutoCancel(true).build()
        if (!custom) notification.flags = notification.flags or Notification.FLAG_INSISTENT
        manager.notify(id, 92, notification)
        if (scheduledDate(routine) == null) runCatching { schedule(context, routine) }
    }
    fun restore(context: Context) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val identity = PairingVault(context).load() ?: return
        if (identity.deviceId != preferences.getString("deviceId", "")) { clear(context); return }
        val routines = JSONObject(preferences.getString("routines", "{}").orEmpty())
        val fired = JSONObject(preferences.getString("fired", "{}").orEmpty())
        // Boot removes Android registrations. Never preserve a receipt for an alarm we could not restore.
        preferences.edit().remove("receipts").putLong("restoreGeneration", preferences.getLong("restoreGeneration", 0) + 1).commit()
        val receipts = JSONObject()
        routines.keys().forEach { id -> val routine = routines.getJSONObject(id)
            val consumed = scheduledDate(routine) != null && fired.optString(id).let { it.isNotBlank() && it == routine.optString("updatedAt") }
            if (!consumed && routine.optBoolean("enabled") && identity.deviceId in DeviceDelivery.alarmTargets(routine)) {
                val receipt = JSONObject().put("routineId", id).put("expectedUpdatedAt", routine.optString("updatedAt"))
                try { val at = schedule(context, routine); receipt.put("status", "scheduled").put("detail", "Restored with Android AlarmManager for $at.") }
                catch (failure: Exception) { receipt.put("status", "failed").put("detail", failure.message.orEmpty()) }
                receipts.put(id, receipt)
            }
        }
        preferences.edit().putString("receipts", receipts.toString()).apply()
    }
}

class PhoneAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            "STOP" -> { AlarmPlaybackService.stop(context, intent.getStringExtra("routine_id")); context.getSystemService(NotificationManager::class.java).cancel(intent.getStringExtra("routine_id"), 92) }
            "FIRE" -> intent.getStringExtra("routine_id")?.let { PhoneAlarmScheduler.fire(context, it, intent.getStringExtra("routine_version")) }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> PhoneAlarmScheduler.restore(context)
        }
    }
}
