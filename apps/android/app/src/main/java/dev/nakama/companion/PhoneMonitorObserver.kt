package dev.nakama.companion

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.os.PowerManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.Instant

/** Explicit, memory-only read consent. It never uses PhoneControlSession or dispatches input. */
object PhoneMonitorObserver {
    private const val CHANNEL = "nakama_readonly_monitor"
    private const val NOTICE = 46
    private data class Consent(val identity: HostIdentity, val monitorId: String, val packageName: String,
        val condition: String, val consentId: String, val expiresAt: Long, val elapsedDeadline: Long, var nextRead: Long = 0)
    private var consent: Consent? = null
    private val revocations = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    var activeId by mutableStateOf<String?>(null); private set
    var status by mutableStateOf("Phone observation is off"); private set
    private fun condition(row: JSONObject) = row.optJSONObject("condition")?.let { it.optString("contains") + "\u0000" + it.optString("excludes") }.orEmpty()
    fun permitsLocalRead(packageName: String): Boolean = consent?.let { it.packageName == packageName && System.currentTimeMillis() < it.expiresAt && SystemClock.elapsedRealtime() < it.elapsedDeadline } == true

    fun readiness(context: Context, packageName: String): String? {
        if (!MonitorPolicy.packageAllowed(packageName)) return "Choose an ordinary app's exact Android package. Protected system apps are unavailable."
        if (!NakamaAccessibilityService.connected) return "Enable Nakama Accessibility in Device settings first."
        if (!MascotOverlayService.running || !android.provider.Settings.canDrawOverlays(context)) return "Enable the visible Mote mascot before allowing app observation."
        if (context.getSystemService(KeyguardManager::class.java).isDeviceLocked || !context.getSystemService(PowerManager::class.java).isInteractive) return "Wake and unlock this phone before allowing observation."
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Read-only app monitoring", NotificationManager.IMPORTANCE_LOW))
        if (!manager.areNotificationsEnabled() || manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return "Enable Nakama's read-only monitoring notification first."
        if (activeId != null && manager.activeNotifications.none { it.id == NOTICE }) return "The monitoring indicator was dismissed. Allow observation again to continue."
        return null
    }
    fun start(context: Context, row: JSONObject, consentId: String, expiresAt: String): String? {
        val identity = PairingVault(context).load() ?: return "Pair this phone before observation."
        val target = row.optString("packageName")
        readiness(context, target)?.let { return it }
        val id = row.optString("id")
        val expiry = runCatching { Instant.parse(expiresAt).toEpochMilli() }.getOrNull() ?: return "The host did not return a valid observation lease."
        val remaining = expiry - System.currentTimeMillis()
        if (!BrowserInputPolicy.id(id) || !BrowserInputPolicy.id(consentId) || row.optString("kind") != "android_app" || row.optString("deviceId") != identity.deviceId || row.optString("status") != "active" || remaining !in 1..1_800_000) return "The host observation lease is unavailable or changed. Review the monitor and allow it again."
        stop(context)
        val stop = PendingIntent.getService(context, NOTICE, Intent(context, MascotOverlayService::class.java).setAction("STOP_MONITOR"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(context, NOTICE + 1, Intent(context, FoundationEntryActivity::class.java).putExtra("foundation_page", "Monitoring").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val manager = context.getSystemService(NotificationManager::class.java)
        try {
            manager.notify(NOTICE, Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_nakama)
                .setContentTitle("Nakama read-only app monitoring")
                .setContentText("One approved app · expires within 30 minutes · tap STOP to end")
                .setVisibility(Notification.VISIBILITY_SECRET).setOngoing(true).setContentIntent(open).setDeleteIntent(stop)
                .addAction(Notification.Action.Builder(null, "STOP observation", stop).build()).build())
        } catch (_: Exception) { return "Android could not show the monitoring notification. Observation remains off." }
        consent = Consent(identity, id, target, condition(row), consentId, expiry, SystemClock.elapsedRealtime() + remaining)
        activeId = id; status = "Read-only consent active. Open the exact app to check its visible labels."
        return null
    }
    fun stop(context: Context, monitorId: String? = null, detail: String = "Phone observation is off") {
        val prior = consent
        if (monitorId != null && prior?.monitorId != monitorId) return
        consent = null; activeId = null; status = detail
        context.getSystemService(NotificationManager::class.java).cancel(NOTICE)
        if (prior != null) revocations.launch {
            runCatching { HostClient(prior.identity).request("POST", "/api/monitors/${prior.monitorId}/observe-revoke", JSONObject().put("consentId", prior.consentId)) }
        }
    }
    /** This loop belongs only to the already-visible Mote foreground service. No boot restart. */
    suspend fun whileMascotVisible(context: Context) {
        while (currentCoroutineContext().isActive) {
            val captured = consent
            if (captured != null) {
                val saved = PairingVault(context).load()
                val unavailable = readiness(context, captured.packageName)
                if (saved != captured.identity || unavailable != null || System.currentTimeMillis() >= captured.expiresAt || SystemClock.elapsedRealtime() >= captured.elapsedDeadline) {
                    stop(context, detail = unavailable ?: "Phone consent expired or pairing changed. Allow observation again to continue.")
                } else if (SystemClock.elapsedRealtime() >= captured.nextRead) {
                    captured.nextRead = SystemClock.elapsedRealtime() + 60_000
                    try {
                        val snapshot = withContext(Dispatchers.IO) { HostClient(captured.identity).request("GET", "/api/monitors") }
                        if (consent !== captured) continue
                        val row = snapshot.objects("monitors").firstOrNull { it.optString("id") == captured.monitorId }
                        if (row == null || !MonitorPolicy.consentCurrent(AttentionPolicy.scope(captured.identity), saved?.let(AttentionPolicy::scope), captured.expiresAt, System.currentTimeMillis(), captured.packageName, row.optString("packageName"), captured.condition, condition(row), row.optString("status"))) {
                            stop(context, detail = "Monitor stopped, changed or became unavailable. Review it before allowing observation again.")
                        } else {
                            val interval = row.optInt("intervalSeconds", 60).coerceIn(30, 86400)
                            captured.nextRead = SystemClock.elapsedRealtime() + interval * 1000L
                            val outcome = NakamaAccessibilityService.observeForMonitor(captured.packageName, row.optJSONObject("condition")?.optString("contains").orEmpty(), row.optJSONObject("condition")?.optString("excludes").orEmpty())
                            if (consent === captured && PairingVault(context).load() == captured.identity && readiness(context, captured.packageName) == null) {
                                val body = JSONObject().put("revision", row.optInt("revision")).put("consentId", captured.consentId).put("packageName", captured.packageName).put("outcome", outcome).put("observedAt", Instant.now().toString())
                                withContext(Dispatchers.IO) { HostClient(captured.identity).request("POST", "/api/monitors/${captured.monitorId}/observation", body) }
                                if (consent === captured) {
                                    status = when (outcome) { "match" -> "The exact visible condition matched. Review the monitor on your PC or phone."; "no_match" -> "The current visible app did not match the condition."; "sensitive" -> "Observation stopped at a sensitive screen. Complete that step yourself."; else -> "The exact app is not visible or its screen cannot be safely inspected." }
                                    if (outcome in listOf("match", "sensitive")) stop(context, detail = status)
                                }
                            }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) {
                        if (consent === captured) {
                            if (failure is HostException && failure.status in listOf(401, 403, 404, 410)) stop(context, detail = "Phone monitoring access ended. Review permissions before starting again.")
                            else status = "The host did not confirm this observation. It is not a successful check."
                        }
                    }
                }
            }
            delay(1500)
        }
    }
}
