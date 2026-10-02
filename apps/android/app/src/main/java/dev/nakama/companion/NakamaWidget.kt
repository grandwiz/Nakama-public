package dev.nakama.companion

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class NakamaWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.nakama_widget)
            val chat = PendingIntent.getActivity(context, id, Intent(context, MainActivity::class.java).putExtra("open_chat", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val voice = PendingIntent.getActivity(context, id + 10000, Intent(context, VoiceEntryActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.widget_root, chat)
            views.setOnClickPendingIntent(R.id.widget_voice, voice)
            manager.updateAppWidget(id, views)
        }
    }
}

/** Non-exported entry point: other apps cannot turn on the microphone with a launcher extra. */
class VoiceEntryActivity : MainActivity() {
    override val startWithVoice = true
}
