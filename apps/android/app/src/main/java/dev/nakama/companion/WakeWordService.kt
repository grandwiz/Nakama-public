package dev.nakama.companion

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONObject

class WakeWordService : Service() {
    companion object {
        var running by mutableStateOf(false); private set
        var status by mutableStateOf("Off"); private set
        var foregroundCommand: ((String) -> Unit)? = null
        internal var recognitionFactoryForTest: (((String) -> Unit, (Int) -> Unit) -> VoiceRecognition)? = null
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
    private var cpuLock: android.os.PowerManager.WakeLock? = null
    private var nextLockRenewal = 0L
    private var followUpIdentity: HostIdentity? = null
    private fun cancelCurrentReply() { continuations.clear(); conversation?.cancel(); voice?.stop(); loop?.cancelFollowUp(); followUpIdentity = null }
    private fun interruptPlayback() { cancelCurrentReply(); PhoneAlarmScheduler.silence(this); LocalTimers.silenceFinished(this) }
    private fun allowFollowUp() { if (!stopped && running) { followUpIdentity = PairingVault(this).load(); loop?.allowFollowUp() } }
    private fun keepCpuReady() {
        val now = SystemClock.elapsedRealtime()
        if (now < nextLockRenewal) return
        val lock = cpuLock ?: getSystemService(android.os.PowerManager::class.java).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Nakama:WakeListening").apply { setReferenceCounted(false) }.also { cpuLock = it }
        lock.acquire(10 * 60_000L); nextLockRenewal = now + 5 * 60_000L
    }
    private var activeIdentity: HostIdentity? = null
    private var activeWorkflowId: String? = null
    private val continuations = ArrayDeque<Pair<HostIdentity, JSONObject>>()
    private val unlocked get() = !getSystemService(KeyguardManager::class.java).isDeviceLocked
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putBoolean("wakeEnabled", false).apply(); stopped = true; status = "Off"; stopSelf(); return START_NOT_STICKY }
        // A system restart may have no Intent. Only the saved, explicit opt-in can revive it.
        if (!getSharedPreferences("nakama_preferences", MODE_PRIVATE).getBoolean("wakeEnabled", false)) {
            stopped = true; status = "Off"; stopSelf(); return START_NOT_STICKY
        }
        if (loop != null) {
            if (intent?.action == "RESTART") { continuations.clear(); conversation?.cancel(); voice?.stop(); loop?.stop(); loop = createWakeLoop().also { it.start() } }
            return START_STICKY
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { status = "Unavailable · allow microphone and notifications"; stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("nakama_wake", "Nakama wake word", NotificationManager.IMPORTANCE_LOW))
        if (manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { status = "Unavailable · enable wake word notifications"; stopSelf(); return START_NOT_STICKY }
        val stop = PendingIntent.getService(this, 72, Intent(this, WakeWordService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 73, Intent(this, FoundationEntryActivity::class.java).putExtra("foundation_page", "Wake word"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        notificationBuilder = Notification.Builder(this, "nakama_wake").setSmallIcon(R.drawable.ic_nakama).setContentTitle("Nakama wake word").setContentText("Preparing bundled speech - waiting for microphone readiness").setContentIntent(open).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(Notification.Action.Builder(null, "Stop listening", stop).build()).setOngoing(true).setOnlyAlertOnce(true)
        try { startForeground(72, notificationBuilder!!.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) }
        catch (_: Exception) { status = "Paused · open Nakama to enable wake listening"; stopSelf(); return START_NOT_STICKY }
        stopped = false; running = true
        continueReplies = { saved, receipts ->
            if (!running || stopped || PairingVault(this).load() != saved || continuations.size + receipts.size > 16) false
            else { receipts.forEach { continuations.addLast(saved to JSONObject(it.toString())) }; true }
        }
        stopReply = ::cancelCurrentReply
        VoiceOutputBus.onStop = ::interruptPlayback
        VoiceOutputBus.onFollowUp = ::allowFollowUp
        VoiceAudioGate.onBusy = { owner -> if (owner !== this) loop?.tick(true) }
        discardWorkflow = { id ->
            continuations.removeAll { it.second.optString("workflowId") == id }
            if (activeWorkflowId == id) { conversation?.cancel(); voice?.stop() }
        }
        voice = VoiceController(this, {}, { activity -> MoteWorkSignals.setVoiceState("wake", if (activity.startsWith("Speaking")) MoteVoiceState.SPEAKING else MoteVoiceState.IDLE) })
        loop = createWakeLoop().also { it.start() }
        scope.launch {
            while (isActive) {
                if (ContextCompat.checkSelfPermission(this@WakeWordService, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !manager.areNotificationsEnabled() || manager.getNotificationChannel("nakama_wake").importance == NotificationManager.IMPORTANCE_NONE) { stopped = true; status = "Paused · microphone or notification permission removed"; stopSelf(); break }
                keepCpuReady()
                if (followUpIdentity != null && PairingVault(this@WakeWordService).load() != followUpIdentity) { loop?.cancelFollowUp(); followUpIdentity = null }
                if (conversation?.isActive != true && !VoiceAudioGate.busy && continuations.isNotEmpty()) launchConversation(accepted = continuations.removeFirst())
                loop?.tick(VoiceAudioGate.busyExcept(this@WakeWordService), stopOnly = conversation?.isActive == true || AlarmAudioState.ringing(this@WakeWordService))
                if (notificationStatus != status) { notificationStatus = status; notificationBuilder?.let { manager.notify(72, it.setContentText(status).build()) } }
                if (loop?.enabled == false) { stopSelf(); break }
                delay(200)
            }
        }
        return START_STICKY
    }
    private fun createWakeLoop(): WakeWordLoop {
        val services = AndroidVoiceServices(this)
        return WakeWordLoop(SystemClock::elapsedRealtime, { result, failure -> recognitionFactoryForTest?.invoke(result, failure) ?: services.wakeRecognition(result, failure) }, { if (conversation?.isActive != true) status = it }, ::heard,
            createFollowUp = { result, failure -> recognitionFactoryForTest?.invoke(result, failure) ?: services.recognition(true, {}, {}, result, failure) },
            createStop = { result, failure -> recognitionFactoryForTest?.invoke(result, failure) ?: checkNotNull(services.stopRecognition(result, failure)) },
            onStop = { VoiceOutputBus.stopAll() })
    }
    private fun heard(command: String) {
        if (!running || stopped || conversation?.isActive == true) return
        if (FoundationPolicy.command(command) == FoundationCommand.StopWake) { getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putBoolean("wakeEnabled", false).apply(); stopped = true; stopSelf(); return }
        if (unlocked) foregroundCommand?.let { it(command); return }
        launchConversation(command)
    }
    private fun launchConversation(command: String? = null, accepted: Pair<HostIdentity, JSONObject>? = null) {
        conversation = scope.launch {
            VoiceAudioGate.set(this@WakeWordService, true)
            var accessWatch: Job? = null
            try {
                val directed = command?.let(DeviceCommandRouting::parse)
                if (directed?.error?.isNotBlank() == true) { say(directed.error); return@launch }
                if (directed != null && !DeviceCommandRouting.isThisDevice(directed.targetName)) {
                    runDirectedCommand(directed)
                    return@launch
                }
                val issuedCommand = directed?.originalCommand ?: command
                if (issuedCommand != null) LocalClockCommands.parse(issuedCommand)?.let { local ->
                    if (local == LocalClockCommand.Open && !unlocked) { localReply(issuedCommand, "Unlock your device to open Clock. You can still set or manage timers by voice."); handoff(page = "Clock"); return@launch }
                    val reply = LocalClockActions.execute(this@WakeWordService, local)
                    localReply(issuedCommand, reply.text)
                    if (local == LocalClockCommand.Open) handoff(page = "Clock")
                    return@launch
                }
                if (issuedCommand != null && (NavigationPolicy.parse(issuedCommand) != null || FoundationPolicy.command(issuedCommand) != null || PhoneCommandParser.parse(issuedCommand) != null)) {
                    if (!handoff(issuedCommand)) localReply(issuedCommand, if (unlocked) "Open Nakama to continue that phone command. Your existing permissions and confirmations still apply." else "Unlock your device to carry out that on-screen phone action. I am still listening.")
                    return@launch
                }
                val saved = accepted?.first ?: PairingVault(this@WakeWordService).load()
                if (saved == null) { say("Pair your PC in Nakama before asking a background question."); handoff(); return@launch }
                activeIdentity = saved; activeWorkflowId = accepted?.second?.optString("workflowId")
                val current = { running && !stopped && PairingVault(this@WakeWordService).load() == saved }
                accessWatch = launch {
                    while (isActive) {
                        delay(4_500)
                        val checked = try { withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state") } }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { null }
                        if (!current() || checked == null || !WakeConversationAccess.allowed(checked, saved.deviceId)) {
                            loop?.cancelFollowUp(); followUpIdentity = null; voice?.stop(); MoteWorkSignals.clearHost(saved); conversation?.cancel(); break
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
                }, current, ::say, { handoff() }, { snapshot ->
                    try { syncAlarms(saved, snapshot, current) }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) {
                        if (failure is HostException && failure.status in listOf(401, 403)) { PhoneAlarmScheduler.clear(this@WakeWordService); alarmRevision = null; throw failure }
                        if (current()) status = "Alarm sync needs attention; it will retry on the next refresh"
                    }
                }, receiptFeedback = { response, snapshot ->
                    AlarmReceiptPolicy.request(response, saved.deviceId)?.let { alarm ->
                        val feedback = PhoneAlarmScheduler.feedback(this@WakeWordService, saved.deviceId, alarm, snapshot.optJSONObject("routineBoard")?.objects("routines").orEmpty())
                        if (feedback?.needsSetup == true && current()) handoff(page = "Routines")
                        feedback?.text
                    }
                })
                if (accepted != null) runner.follow(accepted.second) else runner.run(issuedCommand ?: return@launch)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                MoteWorkSignals.clearHost()
                if (running && !stopped) { say("I couldn't complete that voice request. Open Nakama to check the connection and task status before trying again."); handoff() }
            } finally { accessWatch?.cancel(); activeIdentity = null; activeWorkflowId = null; VoiceAudioGate.set(this@WakeWordService, false); if (!stopped && !status.startsWith("Unavailable")) status = "Waiting for the local microphone" }
        }
    }
    private suspend fun runDirectedCommand(command: DirectedDeviceCommand) {
        val saved = PairingVault(this).load() ?: run { say("Pair your PC before targeting another device. Nothing was redirected."); return }
        activeIdentity = saved
        fun current() = running && !stopped && PairingVault(this).load() == saved
        var accessWatch: Job? = null
        try {
            val directory = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/device-targets") }
            val target = DeviceCommandRouting.resolve(command.targetName, DeviceCommandRouting.targets(directory))
            check(current()) { "The requesting session changed. Nothing was redirected." }
            val result = withContext(Dispatchers.IO) { HostClient(saved).request("POST", "/api/device/commands", DeviceCommandRouting.body(command, target, java.util.UUID.randomUUID().toString()).put("inputMode", "voice")) }
            val state = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state") }
            if (!current() || !WakeConversationAccess.allowed(state, saved.deviceId)) return
            accessWatch = scope.launch {
                while (isActive) {
                    delay(4_500)
                    val fresh = try { withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state") } }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { null }
                    if (!current() || fresh == null || !WakeConversationAccess.allowed(fresh, saved.deviceId)) {
                        loop?.cancelFollowUp(); followUpIdentity = null; voice?.stop(); conversation?.cancel(); break
                    }
                }
            }
            if (current() && DeviceDelivery.addressedTo(result, saved.deviceId))
                say(result.optString("reply").ifBlank { "Request queued for ${target.name}. Completion has not been confirmed." })
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { if (current()) say(error.message ?: "Could not confirm the other-device request. Check its target before retrying.") }
        finally { accessWatch?.cancel() }
    }
    private suspend fun localReply(command: String, text: String) {
        val saved = PairingVault(this).load()
        val selected = LocalChatHistory.scope(saved)
        val blocked = getSharedPreferences("local_chat_access", MODE_PRIVATE).getBoolean(selected, false)
        val localScope = if (blocked) LocalChatHistory.scope(null) else selected
        val history = LocalChatHistory(java.io.File(noBackupFilesDir, "local-chat-history"))
        // Local originals stay on this device and are never included in host requests.
        try { withContext(Dispatchers.IO) {
            for ((role, content) in listOf("user" to command, "assistant" to text)) history.append(localScope,
                JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("role", role).put("content", content).put("createdAt", java.time.Instant.now().toString()))
        } } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { status = "Could not save this local voice exchange"; android.util.Log.w("NakamaLocalHistory", "Could not save a local voice exchange; existing originals were retained.") }
        say(text)
    }
    private suspend fun say(text: String) {
        val output = voice ?: return
        withTimeoutOrNull(10_000) { while (!output.ready && output.engineStatus.startsWith("Loading")) delay(100) }
        if (!running || stopped || (activeIdentity != null && PairingVault(this).load() != activeIdentity)) return
        if (!output.ready) { status = "Unavailable · add an offline British English voice in Nakama Settings"; handoff(); return }
        output.speak(text)
        val session = output.session
        awaitWakeReply(output, { running && !stopped })
        if (running && !stopped && output.session == session && output.activityStatus == "Ready") allowFollowUp()
    }
    private suspend fun syncAlarms(saved: HostIdentity, snapshot: JSONObject, current: () -> Boolean) {
        val permitted = snapshot.objects("devices").firstOrNull { it.optString("id") == saved.deviceId }?.optJSONObject("permissions")?.opt("projectAccess") != false
        if (!permitted) { PhoneAlarmScheduler.clear(this); alarmRevision = null; return }
        val routines = snapshot.optJSONObject("routineBoard")?.objects("routines").orEmpty()
        val revision = PhoneAlarmScheduler.revision(this, routines)
        if (!PhoneAlarmScheduler.enabled(this, saved.deviceId) || revision == alarmRevision) return
        HostAlarmSounds.sync(this, saved, snapshot, current)
        if (!current()) { PhoneAlarmScheduler.clear(this); return }
        val receipts = PhoneAlarmScheduler.sync(this, saved.deviceId, routines)
        for (receipt in receipts) {
            if (!current()) { PhoneAlarmScheduler.clear(this); return }
            val id = receipt.getString("routineId"); receipt.remove("routineId")
            withContext(Dispatchers.IO) { HostClient(saved).request("POST", "/api/routines/$id/device-status", receipt) }
        }
        if (current()) alarmRevision = revision
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
        runCatching { cpuLock?.let { if (it.isHeld) it.release() } }; cpuLock = null
        VoiceOutputBus.onStop = null; VoiceOutputBus.onFollowUp = null; VoiceAudioGate.onBusy = null
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
