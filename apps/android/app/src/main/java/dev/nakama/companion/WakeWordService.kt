package dev.nakama.companion

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import android.speech.SpeechRecognizer
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*

class WakeWordService : Service() {
    companion object {
        var running by mutableStateOf(false); private set
        var status by mutableStateOf("Off"); private set
        var foregroundCommand: ((String) -> Unit)? = null
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var loop: WakeWordLoop? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { status = "Off"; stopSelf(); return START_NOT_STICKY }
        if (loop != null) return START_NOT_STICKY
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Unavailable · allow microphone and notifications"; stopSelf(); return START_NOT_STICKY }
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) { status = "Unavailable · this device has no on-device recognizer. No cloud fallback."; stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("nakama_wake", "Nakama wake word", NotificationManager.IMPORTANCE_LOW))
        if (manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { status = "Unavailable · enable wake word notifications"; stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this, 72, Intent(this, WakeWordService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 73, Intent(this, FoundationEntryActivity::class.java).putExtra("foundation_page", "Wake word"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        try { startForeground(72, Notification.Builder(this, "nakama_wake").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Listening locally for Nakama").setContentText("On-device only · microphone active between conversations").setContentIntent(open).addAction(Notification.Action.Builder(null, "Stop listening", stop).build()).setOngoing(true).build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) }
        catch (_: Exception) { status = "Paused · open Nakama to enable wake listening"; stopSelf(); return START_NOT_STICKY }
        running = true
        val services = AndroidVoiceServices(this)
        loop = WakeWordLoop(SystemClock::elapsedRealtime, { result, failure -> services.recognition(true, {}, {}, result, failure) }, { status = it }, ::heard).also { it.start() }
        scope.launch {
            while (isActive) {
                if (ContextCompat.checkSelfPermission(this@WakeWordService, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !manager.areNotificationsEnabled() || manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { status = "Paused · microphone or notification permission removed"; stopSelf(); break }
                loop?.tick(VoiceAudioGate.busy)
                if (loop?.enabled == false) { stopSelf(); break }
                delay(300)
            }
        }
        return START_NOT_STICKY
    }
    private fun heard(command: String) {
        foregroundCommand?.let { it(command); return }
        val intent = Intent(this, FoundationEntryActivity::class.java).putExtra("wake_command", command).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, 74, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        getSystemService(NotificationManager::class.java).notify(74, Notification.Builder(this, "nakama_wake").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Nakama heard your command").setContentText("Tap to open Nakama and continue").setContentIntent(pending).setAutoCancel(true).build())
        if (MascotOverlayService.running && Settings.canDrawOverlays(this) && !getSystemService(KeyguardManager::class.java).isDeviceLocked) runCatching { startActivity(intent) }
    }
    override fun onDestroy() {
        val previous = status; loop?.stop(); loop = null; scope.cancel(); running = false
        getSystemService(NotificationManager::class.java).cancel(74)
        PendingIntent.getActivity(this, 74, Intent(this, FoundationEntryActivity::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.cancel()
        status = if (previous.startsWith("Unavailable") || previous.startsWith("Paused")) previous else "Off"
        super.onDestroy()
    }
}

/** Only app-internal PendingIntents may carry a captured wake command. */
class FoundationEntryActivity : MainActivity()
