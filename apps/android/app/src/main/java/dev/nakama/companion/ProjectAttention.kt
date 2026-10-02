package dev.nakama.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.*
import org.json.JSONObject
import java.security.MessageDigest

data class AttentionNotice(val id: String, val kind: String, val projectId: String = "", val workflowId: String = "", val questionId: String = "", val browserSessionId: String = "", val intakeId: String = "", val connectionRequestId: String = "", val deliveryId: String = "", val autonomousRunId: String = "", val monitorId: String = "", val selfMaintenanceId: String = "")
object AttentionPolicy {
    fun key(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    fun scope(identity: HostIdentity) = key(identity.url + "|" + identity.fingerprint + "|" + identity.deviceId)
    fun unread(notices: List<AttentionNotice>, seen: Set<String>) = notices.filter { it.kind in setOf("question", "login", "approval", "monitor", "upgrade") && it.id.length in 1..300 && key(it.id) !in seen }.distinctBy { it.id }.take(10)
    fun persisted(old: Set<String>, added: List<String>): Set<String> = (old.toList() + added.map(::key)).distinct().takeLast(500).toSet()
    fun supportsVoiceAnswer(notice: AttentionNotice) = notice.kind == "question" && notice.autonomousRunId.isBlank() && notice.monitorId.isBlank() && notice.selfMaintenanceId.isBlank()
    fun notices(json: JSONObject?): List<AttentionNotice> = if (json?.optInt("version") != 1) emptyList() else json.objects("items").mapNotNull {
        if (it.optString("kind") !in setOf("question", "login", "approval", "monitor", "upgrade") || it.optString("id").length !in 1..300) null
        else AttentionNotice(it.optString("id"), it.optString("kind"), it.optString("projectId"), it.optString("workflowId"), it.optString("questionId"), it.optString("browserSessionId"), it.optString("intakeId"), it.optString("connectionRequestId"), it.optString("deliveryId"), it.optString("autonomousRunId"), it.optString("monitorId"), it.optString("selfMaintenanceId"))
    }
}

/** Generic notifications store hashed receipt IDs only, never question text or login details. */
object ProjectAttention {
    private const val CHANNEL = "nakama_project_attention"
    private const val TAG = "nakama-attention:"
    private fun prefs(context: Context) = context.getSharedPreferences("nakama_attention", Context.MODE_PRIVATE)
    fun enabled(context: Context, identity: HostIdentity?) = identity != null && prefs(context).getBoolean("enabled:${AttentionPolicy.scope(identity)}", false)
    fun setEnabled(context: Context, identity: HostIdentity, value: Boolean) { prefs(context).edit().putBoolean("enabled:${AttentionPolicy.scope(identity)}", value).apply(); if (!value) clear(context) }
    fun clear(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.filter { it.tag?.startsWith(TAG) == true }.forEach { manager.cancel(it.tag, it.id) }
    }
    @Synchronized fun update(context: Context, identity: HostIdentity, attention: JSONObject?) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!enabled(context, identity) || !manager.areNotificationsEnabled()) { clear(context); return }
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Nakama questions and monitoring attention", NotificationManager.IMPORTANCE_DEFAULT))
        if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return
        val scope = AttentionPolicy.scope(identity); val prefix = "$TAG$scope:"
        val notices = AttentionPolicy.notices(attention); val current = notices.map { prefix + AttentionPolicy.key(it.id) }.toSet()
        manager.activeNotifications.filter { it.tag?.startsWith(TAG) == true && it.tag !in current }.forEach { manager.cancel(it.tag, it.id) }
        val seen = prefs(context).getString("seen:$scope", "").orEmpty().split(',').filter { it.matches(Regex("[a-f0-9]{64}")) }.toSet()
        val delivered = mutableListOf<String>()
        for (notice in AttentionPolicy.unread(notices, seen)) {
            val key = AttentionPolicy.key(notice.id)
            fun open(voice: Boolean) = PendingIntent.getActivity(context, (key + voice).hashCode(), Intent(context, FoundationEntryActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .setAction("dev.nakama.ATTENTION.$key.$voice").putExtra("attention_id", notice.id).putExtra("attention_scope", scope).putExtra("attention_voice", voice), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val title = when (notice.kind) { "question" -> if (notice.autonomousRunId.isNotBlank()) "Nakama has a task question" else "Nakama has a project question"; "login" -> "Nakama's browser needs your attention"; "monitor" -> "A Nakama monitor needs your attention"; "upgrade" -> "A Nakama upgrade needs your attention"; else -> "A Nakama action needs your PC approval" }
            val notification = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_nakama).setContentTitle(title)
                .setContentText("Open Nakama to review securely.").setVisibility(Notification.VISIBILITY_SECRET).setOnlyAlertOnce(true).setAutoCancel(true)
                .setGroup("nakama_project_attention").setContentIntent(open(false)).apply {
                    if (AttentionPolicy.supportsVoiceAnswer(notice)) addAction(Notification.Action.Builder(null, "Answer by voice", open(true)).build())
                }.build()
            runCatching { manager.notify(prefix + key, 0, notification) }.onSuccess { delivered += notice.id }
        }
        if (delivered.isNotEmpty()) prefs(context).edit().putString("seen:$scope", AttentionPolicy.persisted(seen, delivered).joinToString(",")).apply()
    }
    /** Runs only inside the user's already-visible Mote service; no hidden or boot polling. */
    suspend fun whileMascotVisible(context: Context) {
        while (currentCoroutineContext().isActive) {
            val saved = PairingVault(context).load()
            if (saved != null && enabled(context, saved)) {
                try {
                    val attention = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/attention") }
                    if (PairingVault(context).load() == saved) update(context, saved, attention) else clear(context)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { if (failure is HostException && failure.status in listOf(401, 403)) clear(context) }
            }
            delay(15_000)
        }
    }
}

data class QuestionDictation(val sequence: Long, val workflowId: String, val questionId: String, val text: String)
