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
    fun silence(context: Context) { JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("routines", "{}").orEmpty()).keys().forEach { context.getSystemService(NotificationManager::class.java).cancel(it, 92) } }
    private fun pending(context: Context, id: String, action: String = "FIRE") = PendingIntent.getBroadcast(context, 0,
        Intent(context, PhoneAlarmReceiver::class.java).setAction(action).setData(Uri.parse("nakama://alarm/${Uri.encode(id)}")).putExtra("routine_id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun next(routine: JSONObject): Instant? {
        val days = routine.optJSONArray("weekdays")
        return FoundationPolicy.nextAlarm(routine.optString("time"), if (days == null) emptySet() else (0 until days.length()).map { days.optInt(it, -1) }.toSet(), routine.optString("timeZone"), Instant.now())
    }
    private fun schedule(context: Context, routine: JSONObject): Instant {
        val manager = context.getSystemService(AlarmManager::class.java)
        check(manager.canScheduleExactAlarms()) { "Allow Alarms & reminders in Android settings, then sync again." }
        check(context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { "Allow Nakama notifications, then sync again." }
        val at = next(routine) ?: error("The alarm needs a valid time, timezone and weekday.")
        val show = PendingIntent.getActivity(context, 91, Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Routines"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.setAlarmClock(AlarmManager.AlarmClockInfo(at.toEpochMilli(), show), pending(context, routine.getString("id")))
        return at
    }
    fun sync(context: Context, deviceId: String, routines: List<JSONObject>): List<JSONObject> {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val old = JSONObject(preferences.getString("routines", "{}").orEmpty())
        val selected = routines.filter { it.optString("kind") == "alarm" && deviceId in DeviceDelivery.alarmTargets(it) }
        val ids = selected.map { it.optString("id") }.toSet()
        old.keys().asSequence().filter { it !in ids }.forEach { context.getSystemService(AlarmManager::class.java).cancel(pending(context, it)); context.getSystemService(NotificationManager::class.java).cancel(it, 92) }
        val saved = JSONObject()
        val results = selected.map { routine ->
            val id = routine.getString("id")
            context.getSystemService(AlarmManager::class.java).cancel(pending(context, id))
            val receipt = JSONObject().put("routineId", id).put("expectedUpdatedAt", routine.optString("updatedAt"))
            if (!routine.optBoolean("enabled")) { context.getSystemService(NotificationManager::class.java).cancel(id, 92); receipt.put("status", "cancelled").put("detail", "This phone's alarm was cancelled.") }
            else {
                saved.put(id, routine)
                try { val at = schedule(context, routine); receipt.put("status", "scheduled").put("detail", "Registered with Android AlarmManager for $at. Sound depends on Android's alarm volume, notification channel and Do Not Disturb settings.") }
                catch (failure: Exception) { receipt.put("status", if (!context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) "permission_required" else "failed").put("detail", failure.message.orEmpty()) }
            }
            receipt
        }
        preferences.edit().putString("routines", saved.toString()).putString("deviceId", deviceId).apply()
        return results
    }
    fun clear(context: Context) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = JSONObject(preferences.getString("routines", "{}").orEmpty())
        saved.keys().forEach { context.getSystemService(AlarmManager::class.java).cancel(pending(context, it)); context.getSystemService(NotificationManager::class.java).cancel(it, 92) }
        preferences.edit().clear().apply()
    }
    fun fire(context: Context, id: String) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (PairingVault(context).load()?.deviceId != preferences.getString("deviceId", "")) { clear(context); return }
        val routine = JSONObject(preferences.getString("routines", "{}").orEmpty()).optJSONObject(id) ?: return
        if (!routine.optBoolean("enabled") || preferences.getString("deviceId", "") !in DeviceDelivery.alarmTargets(routine)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
        manager.createNotificationChannel(NotificationChannel("nakama_routine_alarms", "Nakama routine alarms", NotificationManager.IMPORTANCE_HIGH).apply { setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attributes) })
        val stop = pending(context, id, "STOP")
        val open = PendingIntent.getActivity(context, 91, Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Routines"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, "nakama_routine_alarms").setSmallIcon(R.drawable.ic_nakama).setContentTitle(routine.optString("title", "Nakama alarm")).setContentText("Routine alarm · tap Stop to silence").setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setDeleteIntent(stop).addAction(Notification.Action.Builder(null, "Stop alarm", stop).build()).setAutoCancel(true).build()
        notification.flags = notification.flags or Notification.FLAG_INSISTENT
        manager.notify(id, 92, notification)
        runCatching { schedule(context, routine) }
    }
    fun restore(context: Context) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val identity = PairingVault(context).load() ?: return
        if (identity.deviceId != preferences.getString("deviceId", "")) { clear(context); return }
        val routines = JSONObject(preferences.getString("routines", "{}").orEmpty())
        routines.keys().forEach { id -> val routine = routines.getJSONObject(id); if (routine.optBoolean("enabled") && identity.deviceId in DeviceDelivery.alarmTargets(routine)) runCatching { schedule(context, routine) } }
    }
}

class PhoneAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            "STOP" -> context.getSystemService(NotificationManager::class.java).cancel(intent.getStringExtra("routine_id"), 92)
            "FIRE" -> intent.getStringExtra("routine_id")?.let { PhoneAlarmScheduler.fire(context, it) }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> PhoneAlarmScheduler.restore(context)
        }
    }
}
