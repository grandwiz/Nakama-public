package dev.nakama.companion

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/** Plays a verified private clip. The exact AlarmManager callback may start this service. */
class AlarmPlaybackService : Service() {
    companion object {
        private const val CHANNEL = "nakama_custom_alarm_audio"
        private var active: AlarmPlaybackService? = null
        internal val playing get() = runCatching { active?.player?.isPlaying == true }.getOrDefault(false)
        fun start(context: Context, routineId: String, version: String, soundId: String, title: String): Boolean = runCatching {
            context.startForegroundService(Intent(context, AlarmPlaybackService::class.java).putExtra("routineId", routineId).putExtra("version", version).putExtra("soundId", soundId).putExtra("title", title.take(160))); true
        }.getOrDefault(false)
        fun stop(context: Context, routineId: String? = null) {
            if (routineId == null || active?.routine == routineId) { active?.silence(); context.stopService(Intent(context, AlarmPlaybackService::class.java)) }
        }
    }
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var routine = ""
    private fun silence() { runCatching { player?.stop() }; runCatching { player?.release() }; player = null }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { getSystemService(NotificationManager::class.java).cancel(routine, 92); silence(); stopSelf(); return START_NOT_STICKY }
        val identity = PairingVault(this).load()
        val file = identity?.let { HostAlarmSounds.file(this, it, intent?.getStringExtra("soundId").orEmpty()) }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Custom alarm playback", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null); description = "Custom clips use Android's alarm volume. Stop silences the current clip." })
        if (file == null || !PhoneAlarmScheduler.playbackAuthorized(this, intent?.getStringExtra("routineId").orEmpty(), intent?.getStringExtra("version").orEmpty(), intent?.getStringExtra("soundId").orEmpty()) || !manager.areNotificationsEnabled() || manager.getNotificationChannel(CHANNEL).importance == NotificationManager.IMPORTANCE_NONE) { stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this, 94, Intent(this, AlarmPlaybackService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_nakama).setContentTitle(intent?.getStringExtra("title") ?: "Nakama alarm").setContentText("Say Nakama stop, or tap Stop alarm").setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(true).addAction(Notification.Action.Builder(null, "Stop alarm", stop).build()).build()
        try {
            startForeground(94, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            silence(); active = this; routine = intent?.getStringExtra("routineId").orEmpty()
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setWakeMode(this@AlarmPlaybackService, PowerManager.PARTIAL_WAKE_LOCK)
                setDataSource(file.absolutePath); isLooping = true; prepare(); start()
            }
            handler.removeCallbacksAndMessages(null)
            handler.postDelayed({ silence(); stopSelf() }, 10 * 60_000L)
        } catch (_: Exception) { silence(); stopSelf() }
        return START_NOT_STICKY
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); silence(); if (active === this) active = null; stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy() }
}
