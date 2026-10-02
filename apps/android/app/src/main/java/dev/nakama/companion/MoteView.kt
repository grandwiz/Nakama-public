package dev.nakama.companion

import android.animation.ValueAnimator
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import kotlin.math.min
import kotlin.math.sin

/** Original vector Mote and miniature computer. The screen is symbolic, never a screen capture. */
class MoteView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
    private val showWorkStatus: Boolean = false,
) : View(context, attrs, defStyleAttr) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val silhouette = Path().apply {
        moveTo(19f, 38f); quadTo(12f, 9f, 23f, 11f); quadTo(33f, 13f, 38f, 26f)
        quadTo(50f, 23f, 61f, 26f); quadTo(72f, 6f, 82f, 12f); quadTo(88f, 16f, 80f, 39f)
        cubicTo(96f, 77f, 77f, 88f, 50f, 88f); cubicTo(20f, 89f, 4f, 73f, 19f, 38f); close()
    }
    private val smile = Path().apply { moveTo(43f, 61f); quadTo(50f, 68f, 57f, 61f) }
    var animate = true
        set(value) { field = value; invalidate() }
    var workState = MoteWorkState.IDLE
        set(value) {
            if (field == value) return
            field = value; updateDescription(); invalidate()
        }
    private val preferences = context.getSharedPreferences("nakama_preferences", Context.MODE_PRIVATE)
    private var reduced = preferences.getBoolean("reduceMotion", false)
    private var durationScale = ValueAnimator.getDurationScale()
    private val animationFrame = Runnable { invalidate() }
    private val scaleListener = ValueAnimator.DurationScaleChangeListener { durationScale = it; invalidate() }
    private val preferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "reduceMotion") { reduced = preferences.getBoolean("reduceMotion", false); invalidate() }
    }
    init { updateDescription() }
    private fun updateDescription() {
        contentDescription = if (showWorkStatus) "Mote. ${workState.description}. Tap to talk. Hold to hide Mote and stop phone control." else "Mote, the Nakama companion"
        if (showWorkStatus) stateDescription = workState.description
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        durationScale = ValueAnimator.getDurationScale(); reduced = preferences.getBoolean("reduceMotion", false)
        ValueAnimator.registerDurationScaleChangeListener(scaleListener); preferences.registerOnSharedPreferenceChangeListener(preferenceListener)
    }
    override fun onDetachedFromWindow() {
        removeCallbacks(animationFrame); ValueAnimator.unregisterDurationScaleChangeListener(scaleListener)
        preferences.unregisterOnSharedPreferenceChangeListener(preferenceListener); super.onDetachedFromWindow()
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) invalidate() else removeCallbacks(animationFrame)
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val working = showWorkStatus && workState == MoteWorkState.WORKING
        val moving = animate && (!showWorkStatus || working) && MotionPolicy.enabled(reduced, durationScale, ValueAnimator.areAnimatorsEnabled())
        val clock = MotionPolicy.clock(android.os.SystemClock.uptimeMillis(), durationScale)
        val bob = if (moving) sin(clock / 620.0).toFloat() * 1.4f else 0f
        val scale = min(width / 100f, height / if (showWorkStatus) 120f else 100f)
        canvas.save(); canvas.translate((width - 100f * scale) / 2f, 0f); canvas.scale(scale, scale)
        canvas.save(); canvas.translate(0f, bob)
        paint.color = Color.argb(45, 7, 18, 43)
        canvas.drawOval(14f, 85f, 86f, 94f, paint)
        paint.color = Color.rgb(126, 171, 255); canvas.drawPath(silhouette, paint)
        paint.color = Color.rgb(173, 204, 255); canvas.drawOval(29f, 31f, 54f, 38f, paint)
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
        if (working || showWorkStatus && workState == MoteWorkState.WAITING) drawComputer(canvas, moving, clock)
        if (showWorkStatus) drawStatus(canvas)
        canvas.restore()
        removeCallbacks(animationFrame)
        // Waiting, offline and idle views do not fake typing or continually redraw.
        if (moving && isShown && windowVisibility == VISIBLE) postOnAnimationDelayed(animationFrame, 32L)
    }
    private fun drawComputer(canvas: Canvas, moving: Boolean, clock: Double) {
        paint.color = Color.rgb(25, 43, 75); canvas.drawRoundRect(16f, 59f, 84f, 88f, 4f, 4f, paint)
        paint.color = Color.rgb(211, 229, 255); canvas.drawRoundRect(20f, 63f, 80f, 84f, 2f, 2f, paint)
        paint.color = Color.rgb(61, 114, 182)
        if (workState == MoteWorkState.WAITING) {
            canvas.drawRoundRect(43f, 67f, 47f, 79f, 1f, 1f, paint)
            canvas.drawRoundRect(53f, 67f, 57f, 79f, 1f, 1f, paint)
        } else {
            for (index in 0..2) {
                val step = if (moving) ((clock / 260).toInt() + index) % 3 else index
                canvas.drawRoundRect(28f, 67f + index * 5f, 48f + step * 9f, 70f + index * 5f, 1f, 1f, paint)
            }
        }
        paint.color = Color.rgb(69, 95, 133); canvas.drawRoundRect(11f, 86f, 89f, 94f, 3f, 3f, paint)
        paint.color = Color.rgb(149, 192, 255)
        val tap = if (moving) sin(clock / 130.0).toFloat() * 1.5f else 0f
        canvas.drawOval(24f, 85f + tap, 38f, 91f + tap, paint); canvas.drawOval(62f, 85f - tap, 76f, 91f - tap, paint)
    }
    private fun drawStatus(canvas: Canvas) {
        paint.color = Color.rgb(20, 37, 64); canvas.drawRoundRect(3f, 100f, 97f, 119f, 9f, 9f, paint)
        paint.color = when (workState) {
            MoteWorkState.WORKING -> Color.rgb(115, 227, 177)
            MoteWorkState.WAITING -> Color.rgb(255, 211, 130)
            MoteWorkState.UNAVAILABLE -> Color.rgb(192, 201, 215)
            else -> Color.rgb(180, 210, 255)
        }
        canvas.drawCircle(14f, 109.5f, 3f, paint)
        paint.color = Color.WHITE; paint.textSize = 10f; paint.textAlign = Paint.Align.CENTER
        paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
        canvas.drawText(workState.label, 55f, 113f, paint)
        paint.typeface = android.graphics.Typeface.DEFAULT; paint.textAlign = Paint.Align.LEFT
    }
}
