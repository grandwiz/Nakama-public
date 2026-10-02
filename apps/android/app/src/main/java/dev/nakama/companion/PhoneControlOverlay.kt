package dev.nakama.companion

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button

/** The full-screen drawing never consumes touches; only the separate STOP button does. */
internal class PhoneControlOverlay(context: Context, private val onStop: () -> Unit) {
    private val manager = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private val glow = ControlGlowView(context)
    private val stop = Button(context).apply {
        text = context.getString(R.string.control_stop_seconds, 120)
        contentDescription = "Stop Nakama phone control now"
        setTextColor(Color.WHITE)
        textSize = 14f
        setPadding(dp(18), dp(6), dp(18), dp(6))
        minHeight = dp(48)
        background = GradientDrawable().apply { setColor(Color.rgb(15, 54, 106)); cornerRadius = dp(24).toFloat(); setStroke(dp(2), Color.rgb(93, 176, 255)) }
        setOnClickListener { onStop() }
    }
    private fun dp(value: Int) = (value * density).toInt()
    val attached get() = glow.isAttachedToWindow && stop.isAttachedToWindow

    fun show() {
        try {
            manager.addView(glow, WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply { gravity = Gravity.TOP or Gravity.START; setTitle("Nakama control indicator") })
            manager.addView(stop, WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            ).apply { gravity = Gravity.TOP or Gravity.END; x = dp(12); y = dp(12); setTitle("Nakama stop control") })
        } catch (error: Exception) { close(); throw error }
    }

    fun update(seconds: Int) { stop.text = stop.context.getString(R.string.control_stop_seconds, seconds) }
    fun pointAt(x: Float, y: Float) { glow.pointAt(x, y) }
    fun pointAt(bounds: Rect) { pointAt(bounds.exactCenterX(), bounds.exactCenterY()) }
    fun obscures(x: Float, y: Float): Boolean {
        val location = IntArray(2); stop.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + stop.width, location[1] + stop.height).contains(x.toInt(), y.toInt())
    }
    fun close() {
        glow.clearCursor()
        runCatching { manager.removeViewImmediate(stop) }
        runCatching { manager.removeViewImmediate(glow) }
    }
}

internal class ControlGlowView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density
    private var cursorX = 0f
    private var cursorY = 0f
    private var cursorUntil = 0L
    private val location = IntArray(2)
    private val pointer = Path().apply { moveTo(0f, 0f); lineTo(0f, 25f); lineTo(7f, 19f); lineTo(12f, 29f); lineTo(17f, 26f); lineTo(12f, 17f); lineTo(22f, 16f); close() }
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO; setWillNotDraw(false) }
    fun pointAt(x: Float, y: Float) { cursorX = x; cursorY = y; cursorUntil = SystemClock.uptimeMillis() + 1100; invalidate() }
    fun clearCursor() { cursorUntil = 0; invalidate() }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); clearCursor() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        paint.style = Paint.Style.STROKE
        // Layered translucent strokes provide a soft glow without continuous animation or a screen capture.
        for (layer in 5 downTo 1) {
            paint.color = Color.argb(if (layer == 1) 230 else 18, 65, 159, 255)
            paint.strokeWidth = layer * 4f * density
            canvas.drawRoundRect(2f * density, 2f * density, width - 2f * density, height - 2f * density, 24f * density, 24f * density, paint)
        }
        if (SystemClock.uptimeMillis() >= cursorUntil) return
        getLocationOnScreen(location)
        canvas.save(); canvas.translate(cursorX - location[0], cursorY - location[1]); canvas.scale(density, density)
        paint.color = Color.rgb(42, 143, 255); paint.style = Paint.Style.FILL; canvas.drawPath(pointer, paint)
        paint.color = Color.WHITE; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.6f; canvas.drawPath(pointer, paint)
        canvas.restore()
        postInvalidateDelayed((cursorUntil - SystemClock.uptimeMillis()).coerceAtLeast(1))
    }
}
