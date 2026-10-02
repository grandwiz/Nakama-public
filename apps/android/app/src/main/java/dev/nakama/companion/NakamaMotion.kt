package dev.nakama.companion

import android.animation.ValueAnimator
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

object MotionPolicy {
    fun enabled(reduceMotion: Boolean, systemScale: Float, animatorsEnabled: Boolean = true) =
        !reduceMotion && animatorsEnabled && systemScale.isFinite() && systemScale > 0f
    fun duration(enabled: Boolean, normalMs: Int) = if (enabled) normalMs.coerceIn(0, 600) else 0
    fun clock(elapsedMs: Long, systemScale: Float): Double = elapsedMs / (if (systemScale.isFinite() && systemScale > 0) systemScale.coerceIn(0.1f, 10f) else 1f).toDouble()
}

val LocalNakamaMotion = compositionLocalOf { false }

@Composable
fun NakamaMotion(reduced: Boolean, content: @Composable () -> Unit) {
    var scale by remember { mutableFloatStateOf(ValueAnimator.getDurationScale()) }
    DisposableEffect(Unit) {
        val listener = ValueAnimator.DurationScaleChangeListener { scale = it }
        ValueAnimator.registerDurationScaleChangeListener(listener)
        onDispose { ValueAnimator.unregisterDurationScaleChangeListener(listener) }
    }
    // Compose's frame clock applies Android's nonzero duration scale; do not multiply it again.
    val enabled = MotionPolicy.enabled(reduced, scale, ValueAnimator.areAnimatorsEnabled())
    CompositionLocalProvider(LocalNakamaMotion provides enabled, content = content)
}

/** Only the incoming page is composed: outgoing private content is never retained for a crossfade. */
@Composable
fun MotionPage(page: Any, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val enabled = LocalNakamaMotion.current
    val progress = remember { Animatable(1f) }
    LaunchedEffect(page, enabled) {
        if (!enabled) progress.snapTo(1f)
        else { progress.snapTo(0f); progress.animateTo(1f, tween(180, easing = FastOutSlowInEasing)) }
    }
    Box(modifier.graphicsLayer {
        val value = if (enabled) progress.value else 1f
        alpha = .72f + .28f * value
        translationY = (1f - value) * 10.dp.toPx()
    }, content = content)
}

@Composable
fun MotionStatus(status: String, modifier: Modifier = Modifier) {
    val enabled = LocalNakamaMotion.current
    val target = when (status) {
        "failed", "needs_attention", "blocked" -> MaterialTheme.colorScheme.errorContainer
        "completed", "ready", "scheduled" -> MaterialTheme.colorScheme.secondaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val colour by animateColorAsState(target, tween(MotionPolicy.duration(enabled, 160)), label = "status colour")
    Surface(modifier, color = colour, shape = MaterialTheme.shapes.small) {
        Text(status.replace('_', ' '), Modifier.padding(horizontal = 9.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable fun NakamaBusy(modifier: Modifier = Modifier) {
    if (LocalNakamaMotion.current) LinearProgressIndicator(modifier)
    else Text("Working…", modifier, style = MaterialTheme.typography.labelSmall)
}
