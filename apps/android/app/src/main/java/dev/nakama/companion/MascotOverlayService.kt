package dev.nakama.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.animation.ValueAnimator
import android.content.SharedPreferences
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.sin

/** Original vector mascot: Mote, a rounded blue star-eared companion. No external image assets. */
class MoteView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val silhouette = Path().apply {
        moveTo(19f, 38f); quadTo(12f, 9f, 23f, 11f); quadTo(33f, 13f, 38f, 26f)
        quadTo(50f, 23f, 61f, 26f); quadTo(72f, 6f, 82f, 12f); quadTo(88f, 16f, 80f, 39f)
        cubicTo(96f, 77f, 77f, 88f, 50f, 88f); cubicTo(20f, 89f, 4f, 73f, 19f, 38f); close()
    }
    private val smile = Path().apply { moveTo(43f, 61f); quadTo(50f, 68f, 57f, 61f) }
    var animate = true
    private val preferences = context.getSharedPreferences("nakama_preferences", Context.MODE_PRIVATE)
    private var reduced = preferences.getBoolean("reduceMotion", false)
    private var durationScale = ValueAnimator.getDurationScale()
    private val animationFrame = Runnable { invalidate() }
    private val scaleListener = ValueAnimator.DurationScaleChangeListener { durationScale = it; invalidate() }
    private val preferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key == "reduceMotion") { reduced = preferences.getBoolean("reduceMotion", false); invalidate() } }
    init { contentDescription = "Mote, the Nakama companion" }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); durationScale = ValueAnimator.getDurationScale(); reduced = preferences.getBoolean("reduceMotion", false); ValueAnimator.registerDurationScaleChangeListener(scaleListener); preferences.registerOnSharedPreferenceChangeListener(preferenceListener) }
    override fun onDetachedFromWindow() { removeCallbacks(animationFrame); ValueAnimator.unregisterDurationScaleChangeListener(scaleListener); preferences.unregisterOnSharedPreferenceChangeListener(preferenceListener); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (visibility == VISIBLE) invalidate() else removeCallbacks(animationFrame) }
    override fun performClick(): Boolean { super.performClick(); return true }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val moving = animate && MotionPolicy.enabled(reduced, durationScale, ValueAnimator.areAnimatorsEnabled())
        val clock = MotionPolicy.clock(android.os.SystemClock.uptimeMillis(), durationScale)
        val bob = if (moving) sin(clock / 620.0).toFloat() * 1.8f else 0f
        val scale = width / 100f
        canvas.save(); canvas.scale(scale, scale); canvas.translate(0f, bob)
        paint.color = Color.argb(45, 7, 18, 43)
        canvas.drawOval(14f, 85f, 86f, 94f, paint)
        paint.color = Color.rgb(126, 171, 255)
        canvas.drawPath(silhouette, paint)
        paint.color = Color.rgb(173, 204, 255)
        canvas.drawOval(29f, 31f, 54f, 38f, paint)
        paint.color = Color.rgb(24, 42, 75)
        val blink = moving && clock % 4200 < 140
        if (blink) {
            paint.strokeWidth = 3f; paint.strokeCap = Paint.Cap.ROUND
            canvas.drawLine(29f, 51f, 37f, 51f, paint); canvas.drawLine(63f, 51f, 71f, 51f, paint)
        } else {
            canvas.drawOval(29f, 44f, 38f, 55f, paint); canvas.drawOval(62f, 44f, 71f, 55f, paint)
            paint.color = Color.WHITE; canvas.drawCircle(32f, 47f, 1.5f, paint); canvas.drawCircle(65f, 47f, 1.5f, paint)
        }
        paint.color = Color.rgb(26, 47, 80); paint.style = Paint.Style.STROKE; paint.strokeWidth = 2.5f
        canvas.drawPath(smile, paint)
        paint.style = Paint.Style.FILL; paint.color = Color.rgb(246, 175, 189)
        canvas.drawOval(20f, 56f, 30f, 60f, paint); canvas.drawOval(70f, 56f, 80f, 60f, paint)
        canvas.restore()
        // Decorative movement must leave idle time for input, especially on software-rendered devices.
        removeCallbacks(animationFrame)
        if (moving && isShown && windowVisibility == VISIBLE) postOnAnimationDelayed(animationFrame, 32L)
    }
}

class MascotOverlayService : Service() {
    companion object {
        var running by mutableStateOf(false); private set
        var lastError by mutableStateOf(""); private set
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var mascot: View? = null
    private var manager: WindowManager? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP_MONITOR") { PhoneMonitorObserver.stop(this); if (mascot == null) stopSelf(); return START_NOT_STICKY }
        if (intent?.action == "STOP") { NakamaAccessibilityService.stopSession(); stopSelf(); return START_NOT_STICKY }
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
            while (true) {
                if (!Settings.canDrawOverlays(this@MascotOverlayService)) { stopSelf(); break }
                if (NakamaAccessibilityService.sessionActive) {
                    val sessionToken = NakamaAccessibilityService.sessionToken
                    val identity = PairingVault(this@MascotOverlayService).load()
                    if (identity != null) runCatching {
                        ActionInbox.poll(this@MascotOverlayService, identity, uiOnly = true, canExecute = { NakamaAccessibilityService.matchesSession(sessionToken) && it.optString("type").startsWith("ui_") }) {
                            NakamaAccessibilityService.execute(it.getString("type"), it.optJSONObject("args") ?: org.json.JSONObject(), sessionToken)
                        }
                    }.onFailure { if (it is HostException && it.status == 401) { NakamaAccessibilityService.stopSession() } }
                }
                delay(1800)
            }
        }
        scope.launch { ProjectAttention.whileMascotVisible(this@MascotOverlayService) }
        scope.launch { PhoneMonitorObserver.whileMascotVisible(this@MascotOverlayService) }
        return START_NOT_STICKY
    }
    private fun showMascot() {
        manager = getSystemService(WindowManager::class.java)
        val size = (84 * resources.displayMetrics.density).toInt()
        val params = WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START; x = 18; y = 220 }
        val view = MoteView(this)
        view.setOnClickListener { startActivity(Intent(this, VoiceEntryActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
        var startX = 0; var startY = 0; var downX = 0f; var downY = 0f; var dragged = false; var downTime = 0L
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; downX = event.rawX; downY = event.rawY; dragged = false; downTime = event.eventTime; true }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(event.rawX - downX) + abs(event.rawY - downY) > 12) dragged = true
                    params.x = (startX + event.rawX - downX).toInt().coerceIn(0, (resources.displayMetrics.widthPixels - size).coerceAtLeast(0))
                    params.y = (startY + event.rawY - downY).toInt().coerceIn(0, (resources.displayMetrics.heightPixels - size).coerceAtLeast(0))
                    manager?.updateViewLayout(view, params); true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) {
                        if (event.eventTime - downTime > 650) { NakamaAccessibilityService.stopSession(); stopSelf() }
                        else view.performClick()
                    }
                    true
                }
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
