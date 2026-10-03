package dev.nakama.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.Context

internal object AlarmAudioState {
    fun ringing(context: Context): Boolean = runCatching {
        context.getSystemService(NotificationManager::class.java).activeNotifications.any {
            it.notification.category == Notification.CATEGORY_ALARM && (it.id == 94 || (it.id in setOf(92, 93) && it.notification.flags and Notification.FLAG_INSISTENT != 0))
        }
    }.getOrDefault(false)
}
