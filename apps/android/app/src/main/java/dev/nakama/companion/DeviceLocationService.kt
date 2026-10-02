package dev.nakama.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.IBinder
import android.os.Looper
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.Instant

/** Explicitly started, visible own-phone tracking. Android LocationManager has no Google dependency. */
class DeviceLocationService : Service(), LocationListener {
    companion object {
        var running by mutableStateOf(false); private set
        var status by mutableStateOf("Off"); private set
        var lastFix by mutableStateOf<JSONObject?>(null); private set
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var manager: LocationManager? = null
    private var identity: HostIdentity? = null
    private var latest: JSONObject? = null
    private var posting = false
    override fun onBind(intent: Intent?): IBinder? = null
    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { status = "Off"; lastFix = null; stopSelf(); return START_NOT_STICKY }
        if (running) { if (intent?.action == "REFRESH") refreshLastKnown(); return START_NOT_STICKY }
        identity = PairingVault(this).load()
        if (identity == null || !locationAllowed() || !getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Unavailable · pair your PC and allow location and notifications"; stopSelf(); return START_NOT_STICKY }
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("nakama_location", "Own phone location sharing", NotificationManager.IMPORTANCE_LOW))
        if (notifications.getNotificationChannel("nakama_location").importance == NotificationManager.IMPORTANCE_NONE) { status = "Unavailable · enable location sharing notifications"; stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this, 80, Intent(this, DeviceLocationService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 81, Intent(this, FoundationEntryActivity::class.java).putExtra("foundation_page", "Location"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        try { startForeground(80, Notification.Builder(this, "nakama_location").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Nakama is sharing this phone's location").setContentText("Only with your paired PC · Stop anytime").setContentIntent(open).addAction(Notification.Action.Builder(null, "Stop sharing", stop).build()).setOngoing(true).build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) }
        catch (_: Exception) { status = "Paused · open Nakama to start location sharing"; stopSelf(); return START_NOT_STICKY }
        running = true; lastFix = null; status = "Starting · checking your PC's consent"
        val saved = identity!!
        scope.launch {
            try {
                val consent = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/device/location") }
                check(consent.optBoolean("enabled")) { "Location sharing is not enabled on your PC." }
                check(PairingVault(this@DeviceLocationService).load() == saved && locationAllowed()) { "Pairing or location permission changed." }
                manager = getSystemService(LocationManager::class.java)
                val providers = manager!!.getProviders(true).filter { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }
                check(providers.isNotEmpty()) { "Turn on Location in Android settings." }
                providers.forEach { provider -> manager!!.requestLocationUpdates(provider, 30_000L, 25f, this@DeviceLocationService, Looper.getMainLooper()) }
                status = "Sharing enabled · waiting for a location fix"
                refreshLastKnown()
                while (isActive) {
                    delay(30_000)
                    if (!locationAllowed() || PairingVault(this@DeviceLocationService).load() != saved || !getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Paused · pairing or permission changed"; stopSelf(); break }
                    try {
                        val current = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/device/location") }
                        if (!current.optBoolean("enabled")) { status = "Off · sharing disabled on PC"; stopSelf(); break }
                    } catch (failure: CancellationException) { throw failure }
                    catch (failure: Exception) {
                        if (failure is HostException && failure.status in listOf(401, 403, 409)) { status = "Paused · PC consent or device access removed"; stopSelf(); break }
                        status = "PC unavailable · keeping only the latest fix and retrying in 30 seconds"
                        continue
                    }
                    flush()
                }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { status = "Paused · ${error.message ?: "could not share location"}"; stopSelf() }
        }
        return START_NOT_STICKY
    }
    private fun locationAllowed() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    @SuppressLint("MissingPermission")
    private fun refreshLastKnown() {
        if (!locationAllowed()) return
        manager?.getProviders(true)?.filter { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }?.mapNotNull { runCatching { manager?.getLastKnownLocation(it) }.getOrNull() }?.maxByOrNull { it.time }?.let(::onLocationChanged)
    }
    override fun onLocationChanged(location: Location) {
        if (!running || !FoundationPolicy.validLocation(location.latitude, location.longitude, location.accuracy, location.time, System.currentTimeMillis())) return
        latest = JSONObject().put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble()).put("observedAt", Instant.ofEpochMilli(location.time).toString())
        lastFix = latest
        flush()
    }
    private fun flush() {
        val saved = identity ?: return
        val fix = latest ?: return
        if (runCatching { java.time.Duration.between(Instant.parse(fix.optString("observedAt")), Instant.now()).toMinutes() >= 5 }.getOrDefault(true)) { latest = null; return }
        if (posting || !running) return
        posting = true
        scope.launch {
            try {
                check(PairingVault(this@DeviceLocationService).load() == saved && locationAllowed()) { "Pairing or location permission changed." }
                withContext(Dispatchers.IO) { HostClient(saved).request("POST", "/api/device/location", fix) }
                if (latest === fix) latest = null
                status = "Shared · ${fix.optString("observedAt")} · accuracy ${fix.optDouble("accuracy").toInt()} m"
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                status = "Last fix not shared · ${error.message ?: "PC unavailable"}"
                if (error is HostException && error.status in listOf(401, 403, 409)) stopSelf()
            } finally { posting = false }
        }
    }
    override fun onProviderDisabled(provider: String) { status = "Waiting · Android location provider disabled" }
    override fun onDestroy() { runCatching { manager?.removeUpdates(this) }; manager = null; scope.cancel(); running = false; latest = null; lastFix = null; if (!status.startsWith("Paused") && !status.startsWith("Unavailable") && !status.startsWith("Last fix")) status = "Off"; super.onDestroy() }
}
