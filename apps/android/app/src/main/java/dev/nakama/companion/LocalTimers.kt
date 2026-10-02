package dev.nakama.companion

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

internal class AndroidLocalTimerStorage(context: Context, preferenceName: String = "nakama_local_timers") : LocalTimerStorage {
    private val preferences = context.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
    override fun load(): List<LocalTimer> {
        val values = runCatching { JSONArray(preferences.getString("timers", "[]")) }.getOrElse { return emptyList() }
        return (0 until values.length().coerceAtMost(128)).mapNotNull { index ->
            val row = values.optJSONObject(index) ?: return@mapNotNull null
            val id = row.optString("id"); val title = row.optString("title")
            val duration = row.optLong("durationMillis")
            val status = row.optString("status"); val revision = row.optInt("revision")
            if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}")) || title.length > 80 || title.any(Char::isISOControl) ||
                duration !in 1000L..604_800_000L || revision < 1 || status !in setOf("running", "paused", "finished", "cancelled", "dismissed")) return@mapNotNull null
            LocalTimer(id, title, duration, row.optLong("remainingMillis").coerceIn(0, duration), status, revision,
                row.optLong("createdAt"), row.optLong("endsAt"), row.optLong("elapsedEnd"), row.optInt("bootCount", -1), row.optString("issue").take(300))
        }.distinctBy { it.id }
    }
    override fun save(timers: List<LocalTimer>) {
        val values = JSONArray()
        timers.forEach { timer -> values.put(JSONObject().put("id", timer.id).put("title", timer.title)
            .put("durationMillis", timer.durationMillis).put("remainingMillis", timer.remainingMillis)
            .put("status", timer.status).put("revision", timer.revision).put("createdAt", timer.createdAt)
            .put("endsAt", timer.endsAt).put("elapsedEnd", timer.elapsedEnd).put("bootCount", timer.bootCount).put("issue", timer.issue)) }
        check(preferences.edit().putString("timers", values.toString()).commit()) { "Android could not save this phone timer." }
    }
}

object LocalTimers {
    const val ALERT_CHANNEL = "nakama_local_timer_alerts"
    private const val STATUS_CHANNEL = "nakama_local_timer_status"
    private const val NOTIFICATION_ID = 93
    private const val FIRE = "dev.nakama.LOCAL_TIMER_FIRE"
    private const val PAUSE = "dev.nakama.LOCAL_TIMER_PAUSE"
    private const val CANCEL = "dev.nakama.LOCAL_TIMER_CANCEL"
    private const val DISMISS = "dev.nakama.LOCAL_TIMER_DISMISS"
    fun moment(context: Context) = TimerMoment(System.currentTimeMillis(), SystemClock.elapsedRealtime(), Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1))
    private fun notificationTag(timer: LocalTimer) = "nakama-local-timer:${timer.id}"
    private fun open(context: Context) = PendingIntent.getActivity(context, 93,
        Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Clock").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun pending(context: Context, timer: LocalTimer, action: String) = PendingIntent.getBroadcast(context, 0,
        Intent(context, LocalTimerReceiver::class.java).setAction(action)
            .setData(Uri.parse("nakama://local-timer/${timer.id}/${timer.revision}/$action"))
            .putExtra("timer_id", timer.id).putExtra("timer_revision", timer.revision),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private class AndroidEffects(private val context: Context) : LocalTimerEffects {
        private val alarms = context.getSystemService(AlarmManager::class.java)
        private val notifications = context.getSystemService(NotificationManager::class.java)
        init {
            notifications.createNotificationChannel(NotificationChannel(STATUS_CHANNEL, "Phone timer progress", NotificationManager.IMPORTANCE_LOW))
            notifications.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Phone timer alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
                enableVibration(true)
            })
        }
        override fun unavailable(): String? = when {
            !notifications.areNotificationsEnabled() -> "Allow Nakama notifications in Android settings."
            notifications.getNotificationChannel(ALERT_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE -> "Enable Phone timer alerts in Android notification settings."
            !alarms.canScheduleExactAlarms() -> "Allow Nakama under Alarms & reminders in Android settings."
            else -> null
        }
        override fun schedule(timer: LocalTimer, remainingMillis: Long) {
            unavailable()?.let { error(it) }
            alarms.setAlarmClock(AlarmManager.AlarmClockInfo(timer.endsAt, open(context)), pending(context, timer, FIRE))
            val notification = Notification.Builder(context, STATUS_CHANNEL).setSmallIcon(R.drawable.ic_nakama)
                .setContentTitle(timer.title).setContentText("Phone timer · tap to view Clock").setContentIntent(open(context))
                .setWhen(timer.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
                .setOnlyAlertOnce(true).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE)
                .addAction(Notification.Action.Builder(null, "Pause", pending(context, timer, PAUSE)).build())
                .addAction(Notification.Action.Builder(null, "Cancel timer", pending(context, timer, CANCEL)).build()).build()
            notifications.notify(notificationTag(timer), NOTIFICATION_ID, notification)
        }
        override fun cancel(timer: LocalTimer) { alarms.cancel(pending(context, timer, FIRE)) }
        override fun silence(timer: LocalTimer) { notifications.cancel(notificationTag(timer), NOTIFICATION_ID) }
        override fun notifyFinished(timer: LocalTimer) {
            check(notifications.areNotificationsEnabled() && notifications.getNotificationChannel(ALERT_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE) {
                "The timer finished, but Android notifications or Phone timer alerts are disabled."
            }
            // Remove the quiet countdown so Android treats the separate alarm channel as a fresh alert.
            notifications.cancel(notificationTag(timer), NOTIFICATION_ID)
            val dismiss = pending(context, timer, DISMISS)
            val notification = Notification.Builder(context, ALERT_CHANNEL).setSmallIcon(R.drawable.ic_nakama)
                .setContentTitle("${timer.title} finished").setContentText("${LocalTimerPolicy.duration(timer.durationMillis)} phone timer · tap Stop to silence")
                .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(open(context)).setDeleteIntent(dismiss)
                .addAction(Notification.Action.Builder(null, "Stop timer", dismiss).build()).setAutoCancel(false).build()
            notification.flags = notification.flags or Notification.FLAG_INSISTENT
            notifications.notify(notificationTag(timer), NOTIFICATION_ID, notification)
        }
    }
    fun prepareNotifications(context: Context) { AndroidEffects(context) }
    private fun engine(context: Context) = LocalTimerEngine(AndroidLocalTimerStorage(context), AndroidEffects(context), { moment(context) }, { UUID.randomUUID().toString() })
    @Synchronized fun snapshot(context: Context) = AndroidLocalTimerStorage(context).load()
    @Synchronized fun create(context: Context, seconds: Long, title: String = "") = engine(context).create(seconds, title)
    @Synchronized internal fun createRemote(context: Context, seconds: Long, title: String, id: String): LocalTimer {
        snapshot(context).firstOrNull { it.id == id }?.let { return it }
        return LocalTimerEngine(AndroidLocalTimerStorage(context), AndroidEffects(context), { moment(context) }, { id }).create(seconds, title)
    }
    @Synchronized fun change(context: Context, id: String, revision: Int, action: String) = engine(context).change(id, revision, action)
    @Synchronized fun restore(context: Context) { engine(context).restore() }
    @Synchronized fun receive(context: Context, intent: Intent) {
        when (intent.action) {
            FIRE -> intent.getStringExtra("timer_id")?.let { engine(context).fire(it, intent.getIntExtra("timer_revision", -1)) }
            PAUSE, CANCEL, DISMISS -> intent.getStringExtra("timer_id")?.let {
                engine(context).change(it, intent.getIntExtra("timer_revision", -1), when (intent.action) { PAUSE -> "pause"; CANCEL -> "cancel"; else -> "dismiss" })
            }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_MY_PACKAGE_REPLACED,
            AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED -> restore(context)
        }
    }
}
class LocalTimerReceiver : BroadcastReceiver() {
    // receive() dispatches only listed system/timer actions; the receiver is non-exported and
    // timer mutations additionally require the persisted id + revision, rejecting stale intents.
    @android.annotation.SuppressLint("UnsafeProtectedBroadcastReceiver")
    override fun onReceive(context: Context, intent: Intent) { runCatching { LocalTimers.receive(context, intent) } }
}

object LocalClockActions {
    fun execute(context: Context, command: LocalClockCommand): LocalClockReply {
        LocalClockCommands.immediate(command, Instant.now(), ZoneId.systemDefault())?.let { return LocalClockReply(it) }
        return try {
            when (command) {
                LocalClockCommand.Open -> LocalClockReply("Opened Clock. Phone timers run on this device.", true)
                is LocalClockCommand.Invalid -> LocalClockReply(command.explanation, true)
                is LocalClockCommand.CreateTimer -> result(LocalTimers.create(context, command.seconds, command.title))
                is LocalClockCommand.ListTimers -> {
                    val timers = select(LocalTimers.snapshot(context), command.title)
                    val now = LocalTimers.moment(context)
                    LocalClockReply(if (timers.isEmpty()) "There are no matching active phone timers." else timers.joinToString(" ") {
                        if (it.status == "finished") "${it.title} has finished." else "${it.title}: ${LocalTimerPolicy.duration(LocalTimerPolicy.remaining(it, now))} remaining, ${it.status}."
                    }, true)
                }
                is LocalClockCommand.ChangeTimer -> {
                    val timers = select(LocalTimers.snapshot(context), command.title)
                    when {
                        timers.isEmpty() -> LocalClockReply("There is no matching active phone timer.", true)
                        timers.size > 1 -> LocalClockReply("There is more than one matching phone timer. Open Clock and choose which one to ${command.action}.", true)
                        else -> timers.single().let { result(LocalTimers.change(context, it.id, it.revision, command.action)) }
                    }
                }
                else -> LocalClockReply("Open Clock to view phone timers.", true)
            }
        } catch (error: Exception) { LocalClockReply(error.message ?: "The phone timer could not be changed. Check Clock before trying again.", true) }
    }
    private fun select(timers: List<LocalTimer>, title: String?) = timers.filter { timer ->
        timer.status in LocalTimerPolicy.active && (title == null || timer.title.equals(title, true) || timer.title.removeSuffix(" timer").equals(title, true))
    }
    fun result(timer: LocalTimer): LocalClockReply = LocalClockReply(when {
        timer.issue.isNotBlank() && timer.status == "finished" -> "${timer.title} finished, but its phone alert could not be confirmed. ${timer.issue}"
        timer.issue.isNotBlank() -> "Saved ${timer.title} paused, with ${LocalTimerPolicy.duration(timer.remainingMillis)} remaining. ${timer.issue} Then tap Resume in Clock. It is not scheduled to ring."
        timer.status == "running" -> "${timer.title} started on this phone for ${LocalTimerPolicy.duration(timer.remainingMillis)}."
        timer.status == "paused" -> "${timer.title} paused with ${LocalTimerPolicy.duration(timer.remainingMillis)} remaining."
        timer.status == "finished" -> "${timer.title} has finished."
        timer.status == "dismissed" -> "${timer.title} stopped."
        else -> "${timer.title} cancelled."
    }, true)
}
