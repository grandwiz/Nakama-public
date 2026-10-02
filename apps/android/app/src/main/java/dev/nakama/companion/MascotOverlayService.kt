package dev.nakama.companion

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

class MascotOverlayService : Service() {
    companion object {
        var running by mutableStateOf(false); private set
        var lastError by mutableStateOf(""); private set
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var mascot: MoteView? = null
    private var manager: WindowManager? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP_MONITOR") { PhoneMonitorObserver.stop(this); if (mascot == null) stopSelf(); return START_NOT_STICKY }
        if (intent?.action == "STOP") { stopMascotAndControl(); return START_NOT_STICKY }
        if (!Settings.canDrawOverlays(this) || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            lastError = "Allow Display over other apps and notifications in Android settings, then enable the mascot again."
            stopSelf(); return START_NOT_STICKY
        }
        if (mascot != null) return START_NOT_STICKY
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("nakama_mascot", "Nakama mascot", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 10, Intent(this, MainActivity::class.java).putExtra("open_chat", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 11, Intent(this, MascotOverlayService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "nakama_mascot").setSmallIcon(R.drawable.ic_nakama)
            .setContentTitle("Nakama is here").setContentText("Tap Mote to talk. Hold Mote to stop.")
            .setContentIntent(open).addAction(Notification.Action.Builder(null, "Stop mascot & control", stop).build()).setOngoing(true).build()
        try {
            startForeground(41, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            showMascot(); running = true; lastError = ""
        } catch (_: Exception) {
            lastError = "Android could not show Mote. Check Display over other apps and notifications, then try again."
            stopSelf(); return START_NOT_STICKY
        }
        scope.launch {
            while (currentCoroutineContext().isActive) {
                if (!Settings.canDrawOverlays(this@MascotOverlayService)) { stopSelf(); break }
                if (NakamaAccessibilityService.sessionActive) {
                    val sessionToken = NakamaAccessibilityService.sessionToken
                    val identity = PairingVault(this@MascotOverlayService).load()
                    if (identity != null) runCatching {
                        ActionInbox.poll(this@MascotOverlayService, identity, uiOnly = true, canExecute = { NakamaAccessibilityService.matchesSession(sessionToken) && it.optString("type").startsWith("ui_") }) {
                            val work = MoteWorkSignals.beginLocalWork()
                            try { NakamaAccessibilityService.execute(it.getString("type"), it.optJSONObject("args") ?: org.json.JSONObject(), sessionToken) }
                            finally { MoteWorkSignals.endLocalWork(work) }
                        }
                    }.onFailure { if (it is HostException && it.status == 401) { NakamaAccessibilityService.stopSession() } }
                }
                delay(1800)
            }
        }
        scope.launch { refreshWorkWhileVisible() }
        scope.launch {
            while (currentCoroutineContext().isActive) {
                mascot?.workState = MoteWorkSignals.current(PairingVault(this@MascotOverlayService).load())
                delay(500)
            }
        }
        scope.launch { PhoneMonitorObserver.whileMascotVisible(this@MascotOverlayService) }
        return START_NOT_STICKY
    }
    /** Visible-service status and addressed timer delivery. No model calls, app launches or screen reading. */
    private suspend fun refreshWorkWhileVisible() {
        while (currentCoroutineContext().isActive) {
            val saved = PairingVault(this).load()
            if (saved == null) { MoteWorkSignals.clearHost(); ProjectAttention.clear(this) }
            else if (!MoteWorkSignals.hasRecentHost(saved)) {
                val startedAt = SystemClock.elapsedRealtime()
                try {
                    val snapshot = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state") }
                    if (PairingVault(this).load() == saved && MoteWorkSignals.updateHost(saved, snapshot, startedAt)) {
                        if (MoteWorkSignals.permitted(saved, snapshot)) {
                            ProjectAttention.update(this, saved, snapshot.optJSONObject("attention"))
                            val confirm = getSharedPreferences("nakama_preferences", MODE_PRIVATE).getBoolean("confirmActions", false) || snapshot.optJSONObject("config")?.optBoolean("confirmOrdinaryActions") == true
                            if (!confirm) ActionInbox.poll(this, saved, timerOnly = true, canExecute = { PairingVault(this).load() == saved }) {
                                RemotePhoneTimers.execute(this, saved, it)
                            }
                        }
                        else ProjectAttention.clear(this)
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) {
                    if (MoteWorkSignals.clearHost(saved, startedAt)) ProjectAttention.clear(this)
                }
            }
            val state = MoteWorkSignals.current(saved)
            delay(if (state == MoteWorkState.WORKING || state == MoteWorkState.WAITING) 5_000 else 15_000)
        }
    }
    private fun stopMascotAndControl() { NakamaAccessibilityService.stopSession(); stopSelf() }
    private fun showMascot() {
        manager = getSystemService(WindowManager::class.java)
        val width = (100 * resources.displayMetrics.density).toInt()
        val height = (120 * resources.displayMetrics.density).toInt()
        val params = WindowManager.LayoutParams(width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START; x = 18; y = 220; setTitle("Nakama Mote status") }
        val view = MoteView(this, showWorkStatus = true)
        view.setOnClickListener { startActivity(Intent(this, VoiceEntryActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
        view.setOnLongClickListener { stopMascotAndControl(); true }
        var startX = 0; var startY = 0; var downX = 0f; var downY = 0f; var dragged = false; var downTime = 0L
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; downX = event.rawX; downY = event.rawY; dragged = false; downTime = event.eventTime; true }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(event.rawX - downX) + abs(event.rawY - downY) > 12) dragged = true
                    params.x = (startX + event.rawX - downX).toInt().coerceIn(0, (resources.displayMetrics.widthPixels - width).coerceAtLeast(0))
                    params.y = (startY + event.rawY - downY).toInt().coerceIn(0, (resources.displayMetrics.heightPixels - height).coerceAtLeast(0))
                    manager?.updateViewLayout(view, params); true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) { if (event.eventTime - downTime > 650) view.performLongClick() else view.performClick() }
                    true
                }
                MotionEvent.ACTION_CANCEL -> { dragged = false; true }
                else -> false
            }
        }
        mascot = view
        manager?.addView(view, params)
    }
    override fun onDestroy() {
        PhoneMonitorObserver.stop(this, detail = "Mote stopped; phone observation is off.")
        running = false
        scope.cancel()
        NakamaAccessibilityService.stopSession()
        mascot?.let { runCatching { manager?.removeView(it) } }
        mascot = null
        super.onDestroy()
    }
}
