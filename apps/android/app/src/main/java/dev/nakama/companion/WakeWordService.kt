package dev.nakama.companion

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import android.speech.SpeechRecognizer
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONObject

class WakeWordService : Service() {
    companion object {
        var running by mutableStateOf(false); private set
        var status by mutableStateOf("Off"); private set
        var foregroundCommand: ((String) -> Unit)? = null
        internal var continueReplies: ((HostIdentity, List<JSONObject>) -> Boolean)? = null
        internal var stopReply: (() -> Unit)? = null
        internal var discardWorkflow: ((String) -> Unit)? = null
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var loop: WakeWordLoop? = null
    private var voice: VoiceController? = null
    private var conversation: Job? = null
    private var stopped = false
    private var notificationBuilder: Notification.Builder? = null
    private var notificationStatus = ""
    private var alarmRevision: String? = null
    private var activeIdentity: HostIdentity? = null
    private var activeWorkflowId: String? = null
    private val continuations = ArrayDeque<Pair<HostIdentity, JSONObject>>()
    private val unlocked get() = !getSystemService(KeyguardManager::class.java).isDeviceLocked
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putBoolean("wakeEnabled", false).apply(); stopped = true; status = "Off"; stopSelf(); return START_NOT_STICKY }
        if (loop != null) {
            if (intent?.action == "RESTART") { continuations.clear(); conversation?.cancel(); voice?.stop(); loop?.stop(); loop = createWakeLoop().also { it.start() } }
            return START_NOT_STICKY
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Unavailable · allow microphone and notifications"; stopSelf(); return START_NOT_STICKY }
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) { status = "Unavailable · this device has no on-device recognizer. No cloud fallback."; stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("nakama_wake", "Nakama wake word", NotificationManager.IMPORTANCE_LOW))
        if (manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { status = "Unavailable · enable wake word notifications"; stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this, 72, Intent(this, WakeWordService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 73, Intent(this, FoundationEntryActivity::class.java).putExtra("foundation_page", "Wake word"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        notificationBuilder = Notification.Builder(this, "nakama_wake").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Nakama wake word").setContentText("Starting local microphone - waiting for Android readiness").setContentIntent(open).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(Notification.Action.Builder(null, "Stop listening", stop).build()).setOngoing(true).setOnlyAlertOnce(true)
        try { startForeground(72, notificationBuilder!!.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) }
        catch (_: Exception) { status = "Paused · open Nakama to enable wake listening"; stopSelf(); return START_NOT_STICKY }
        stopped = false; running = true
        continueReplies = { saved, receipts ->
            if (!running || stopped || !unlocked || PairingVault(this).load() != saved || continuations.size + receipts.size > 16) false
            else { receipts.forEach { continuations.addLast(saved to JSONObject(it.toString())) }; true }
        }
        stopReply = { continuations.clear(); conversation?.cancel(); voice?.stop() }
        discardWorkflow = { id ->
            continuations.removeAll { it.second.optString("workflowId") == id }
            if (activeWorkflowId == id) { conversation?.cancel(); voice?.stop() }
        }
        voice = VoiceController(this, {}, { activity -> MoteWorkSignals.setVoiceState("wake", if (activity.startsWith("Speaking")) MoteVoiceState.SPEAKING else MoteVoiceState.IDLE) })
        loop = createWakeLoop().also { it.start() }
        scope.launch {
            while (isActive) {
                if (ContextCompat.checkSelfPermission(this@WakeWordService, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !manager.areNotificationsEnabled() || manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { stopped = true; status = "Paused · microphone or notification permission removed"; stopSelf(); break }
                if (!unlocked) { continuations.clear(); if (conversation?.isActive == true) { conversation?.cancel(); voice?.stop() } }
                if (unlocked && conversation?.isActive != true && !VoiceAudioGate.busy && continuations.isNotEmpty()) launchConversation(accepted = continuations.removeFirst())
                loop?.tick(VoiceAudioGate.busy || conversation?.isActive == true || !unlocked)
                if (!unlocked) status = "Paused · unlock your phone for wake requests"
                if (notificationStatus != status) { notificationStatus = status; notificationBuilder?.let { manager.notify(72, it.setContentText(status).build()) } }
                if (loop?.enabled == false) { stopSelf(); break }
                delay(200)
            }
        }
        return START_NOT_STICKY
    }
    private fun createWakeLoop(): WakeWordLoop {
        val services = AndroidVoiceServices(this)
        return WakeWordLoop(SystemClock::elapsedRealtime, { result, failure -> services.wakeRecognition(result, failure) }, { if (conversation?.isActive != true) status = it }, ::heard)
    }
    private fun heard(command: String) {
        if (!running || stopped || !unlocked || conversation?.isActive == true) return
        if (FoundationPolicy.command(command) == FoundationCommand.StopWake) { getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putBoolean("wakeEnabled", false).apply(); stopped = true; stopSelf(); return }
        foregroundCommand?.let { it(command); return }
        launchConversation(command)
    }
    private fun launchConversation(command: String? = null, accepted: Pair<HostIdentity, JSONObject>? = null) {
        conversation = scope.launch {
            VoiceAudioGate.set(this@WakeWordService, true)
            var accessWatch: Job? = null
            try {
                if (command != null) LocalClockCommands.parse(command)?.let { local ->
                    val reply = LocalClockActions.execute(this@WakeWordService, local)
                    say(reply.text)
                    if (local == LocalClockCommand.Open) handoff(page = "Clock")
                    return@launch
                }
                if (command != null && (NavigationPolicy.parse(command) != null || FoundationPolicy.command(command) != null || PhoneCommandParser.parse(command) != null)) {
                    if (!handoff(command)) say("Open Nakama to continue that phone command. Your existing permissions and confirmations still apply.")
                    return@launch
                }
                val saved = accepted?.first ?: PairingVault(this@WakeWordService).load()
                if (saved == null) { say("Pair your PC in Nakama before asking a background question."); handoff(); return@launch }
                activeIdentity = saved; activeWorkflowId = accepted?.second?.optString("workflowId")
                val current = { running && !stopped && unlocked && PairingVault(this@WakeWordService).load() == saved }
                accessWatch = launch {
                    while (isActive) {
                        delay(4_500)
                        val checked = try { withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state") } }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { null }
                        if (!current() || checked == null || !WakeConversationAccess.allowed(checked, saved.deviceId)) {
                            voice?.stop(); MoteWorkSignals.clearHost(saved); conversation?.cancel(); break
                        }
                    }
                }
                status = "Working on your voice request"
                val runner = WakeConversation(saved.deviceId, { method, path, body ->
                    check(current()) { "The pairing or wake session changed." }
                    val startedAt = SystemClock.elapsedRealtime()
                    val work = if (method == "POST" && path == "/api/chat") MoteWorkSignals.beginLocalWork() else null
                    try {
                        val result = withContext(Dispatchers.IO) { HostClient(saved).request(method, path, body) }
                        check(current()) { "The pairing or wake session changed." }
                        if (path == "/api/state") MoteWorkSignals.updateHost(saved, result, startedAt)
                        if (path == "/api/chat") { activeWorkflowId = result.optString("workflowId") }
                        result
                    } finally { work?.let(MoteWorkSignals::endLocalWork) }
                }, current, ::say, { handoff() }, { snapshot -> syncAlarms(saved, snapshot, current) })
                if (accepted != null) runner.follow(accepted.second) else runner.run(command ?: return@launch)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                MoteWorkSignals.clearHost()
                if (running && !stopped && unlocked) { say("I couldn't complete that voice request. Open Nakama to check the connection and task status before trying again."); handoff() }
            } finally { accessWatch?.cancel(); activeIdentity = null; activeWorkflowId = null; VoiceAudioGate.set(this@WakeWordService, false); if (!stopped && !status.startsWith("Unavailable")) status = "Waiting for the local microphone" }
        }
    }
    private suspend fun say(text: String) {
        val output = voice ?: return
        withTimeoutOrNull(10_000) { while (!output.ready && output.engineStatus.startsWith("Loading")) delay(100) }
        if (!running || stopped || !unlocked || (activeIdentity != null && PairingVault(this).load() != activeIdentity)) return
        if (!output.ready) { status = "Unavailable · add an offline British English voice in Nakama Settings"; handoff(); return }
        output.speak(text)
        withTimeoutOrNull(180_000) { while (!output.replyPlaybackAvailable && running && !stopped && unlocked) delay(100) }
        if (!unlocked) output.stop()
    }
    private suspend fun syncAlarms(saved: HostIdentity, snapshot: JSONObject, current: () -> Boolean) {
        val permitted = snapshot.objects("devices").firstOrNull { it.optString("id") == saved.deviceId }?.optJSONObject("permissions")?.opt("projectAccess") != false
        if (!permitted) { PhoneAlarmScheduler.clear(this); alarmRevision = null; return }
        val routines = snapshot.optJSONObject("routineBoard")?.objects("routines").orEmpty()
        val revision = routines.joinToString("|") { it.optString("id") + ":" + it.optString("updatedAt") }
        if (!PhoneAlarmScheduler.enabled(this, saved.deviceId) || revision == alarmRevision) return
        alarmRevision = revision
        val receipts = PhoneAlarmScheduler.sync(this, saved.deviceId, routines)
        for (receipt in receipts) {
            if (!current()) { PhoneAlarmScheduler.clear(this); return }
            val id = receipt.getString("routineId"); receipt.remove("routineId")
            withContext(Dispatchers.IO) { HostClient(saved).request("POST", "/api/routines/$id/device-status", receipt) }
            if (receipt.optString("status") in listOf("permission_required", "failed")) { say(receipt.optString("detail")); handoff() }
        }
    }
    private fun handoff(command: String? = null, page: String? = null): Boolean {
        if (!running || stopped) return false
        val intent = Intent(this, FoundationEntryActivity::class.java).putExtra("open_chat", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (page != null) intent.putExtra("foundation_page", page)
        if (command != null) intent.putExtra("wake_command", command).putExtra("wake_captured_at", SystemClock.elapsedRealtime())
        val pending = PendingIntent.getActivity(this, 74, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        getSystemService(NotificationManager::class.java).notify(74, Notification.Builder(this, "nakama_wake").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Nakama needs your attention").setContentText("Tap to open your conversation").setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(pending).setAutoCancel(true).build())
        return (command != null || page != null) && MascotOverlayService.running && Settings.canDrawOverlays(this) && unlocked && runCatching { startActivity(intent); true }.getOrDefault(false)
    }
    override fun onDestroy() {
        val previous = status; stopped = true; loop?.stop(); loop = null; scope.cancel(); voice?.close(); voice = null; VoiceAudioGate.set(this, false); running = false
        continueReplies = null; stopReply = null; discardWorkflow = null; continuations.clear()
        MoteWorkSignals.setVoiceState("wake", MoteVoiceState.IDLE)
        getSystemService(NotificationManager::class.java).cancel(74)
        PendingIntent.getActivity(this, 74, Intent(this, FoundationEntryActivity::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.cancel()
        status = if (previous.startsWith("Unavailable") || previous.startsWith("Paused")) previous else "Off"
        super.onDestroy()
    }
}

/** Only app-internal PendingIntents may carry a captured wake command. */
class FoundationEntryActivity : MainActivity()
