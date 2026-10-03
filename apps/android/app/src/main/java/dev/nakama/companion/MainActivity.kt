package dev.nakama.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

open class MainActivity : ComponentActivity() {
    protected open val startWithVoice = false
    private lateinit var vault: PairingVault
    private lateinit var voice: VoiceController
    private val screenOffReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_SCREEN_OFF) {
                voiceLaunch.cancel(); voice.pauseCapture(); handoffSpokenReplies()
            }
        }
    }
    private var identity by mutableStateOf<HostIdentity?>(null)
    private var state by mutableStateOf(JSONObject())
    private var stateIdentity by mutableStateOf<HostIdentity?>(null)
    private var stateRequestGeneration = 0L
    private val stateRefreshMutex = Mutex()
    private val actionsRefreshMutex = Mutex()
    private var checksProjectId by mutableStateOf<String?>(null)
    private var githubProjectId by mutableStateOf<String?>(null)
    private var filesProjectId by mutableStateOf<String?>(null)
    private var connectionRequestId by mutableStateOf<String?>(null)
    private var browserSessionId by mutableStateOf<String?>(null)
    private var focusedWorkflowId by mutableStateOf<String?>(null)
    private var questionDictation by mutableStateOf<QuestionDictation?>(null)
    private var voiceQuestionTarget: Pair<String, String>? = null
    private var voiceIntakeTarget: Pair<String, String>? = null
    private var focusedIntakeId by mutableStateOf<String?>(null)
    private var intakeDictation by mutableStateOf<QuestionDictation?>(null)
    private var pendingAttention: Triple<String, String, Boolean>? = null
    private var projectAlertsEnabled by mutableStateOf(false)
    private var importGithub by mutableStateOf(false)
    private val navigationReceipts = NavigationReceiptGate()
    private var currentTab by mutableStateOf("Home")
    private var tab: String
        get() = currentTab
        set(value) { navigationReceipts.invalidate(); appSelection = null; cancelQuestionVoice(); currentTab = value }
    private var currentFoundationPage by mutableStateOf("Tasks")
    private var foundationPage: String
        get() = currentFoundationPage
        set(value) { navigationReceipts.invalidate(); appSelection = null; cancelQuestionVoice(); currentFoundationPage = value }
    private var remoteVoiceCommand by mutableStateOf(0L to "")
    private var pendingWakeCommand: String? = null
    private var pendingWakeCapturedAt = 0L
    private var foundationPermissionAction: String? = null
    private var foundationPermissionMode = ReplyMode.TEXT
    private var alarmRevision: String? = null
    private var notice by mutableStateOf("")
    private var connection by mutableStateOf("Not paired")
    private var busy by mutableStateOf(false)
    private var foreground = false
    private var draft by mutableStateOf("")
    private var chatSubmission by mutableStateOf<ChatSubmission?>(null)
    private var automatic by mutableStateOf(true)
    private var showAdvanced by mutableStateOf(false)
    private var selectedProvider by mutableStateOf("codex")
    private var currentProject by mutableStateOf("")
    private var selectedProject: String
        get() = currentProject
        set(value) { navigationReceipts.invalidate(); appSelection = null; cancelQuestionVoice(); currentProject = value }
    private var selectedModel by mutableStateOf("")
    private var effort by mutableStateOf("high")
    private var team by mutableStateOf(false)
    private var chatMode by mutableStateOf("Discuss")
    private var voiceState by mutableStateOf("Ready")
    private var appSelectionMode = ReplyMode.TEXT
    private var contactSelectionMode = ReplyMode.TEXT
    private var reduceMotion by mutableStateOf(false)
    private var confirmActions by mutableStateOf(false)
    private var themeChoice by mutableStateOf("System")
    private var pendingAction by mutableStateOf<JSONObject?>(null)
    private var contactSelection by mutableStateOf<Pair<PhoneCommandParser.Command, List<ContactChoice>>?>(null)
    private var appSelection by mutableStateOf<List<Pair<String, String>>?>(null)
    private var appSelectionTicket = 0L
    private val localMessages = mutableStateListOf<JSONObject>()
    private lateinit var localChatHistory: LocalChatHistory
    private val localChatMutex = Mutex()
    private val unsavedLocalMessages = mutableMapOf<String, MutableList<JSONObject>>()
    private var localHistoryBlocked by mutableStateOf(false)
    private var localHistoryRevision by mutableIntStateOf(0)
    private fun localChatScope() = LocalChatHistory.scope(if (localHistoryBlocked) null else identity)
    private fun blockLocalHistory(blocked: Boolean) {
        localHistoryBlocked = blocked
        identity?.let { getSharedPreferences("local_chat_access", MODE_PRIVATE).edit().putBoolean(LocalChatHistory.scope(it), blocked).apply() }
    }
    private suspend fun refreshLocalTranscript() = localChatMutex.withLock {
        val selected = localChatScope()
        try {
            val entries = withContext(Dispatchers.IO) { localChatHistory.current(selected) } + unsavedLocalMessages[selected].orEmpty()
            if (localChatScope() == selected) {
                if (localMessages.map { it.optString("id") } != entries.map { it.optString("id") }) { localMessages.clear(); localMessages.addAll(entries); localHistoryRevision++ }
            }
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { notice = failure.message ?: "Could not read local history. Its files have been retained." }
    }
    private fun recordLocalMessage(role: String, text: String) {
        val selected = localChatScope()
        val message = JSONObject().put("id", "local-${java.util.UUID.randomUUID()}").put("role", role).put("content", text).put("createdAt", Instant.now().toString())
        localMessages += message
        unsavedLocalMessages.getOrPut(selected) { mutableListOf() }.add(message)
        lifecycleScope.launch {
            localChatMutex.withLock {
                if (unsavedLocalMessages[selected]?.none { it === message } != false) return@withLock
                try {
                    withContext(Dispatchers.IO) { localChatHistory.append(selected, message) }
                    unsavedLocalMessages[selected]?.remove(message); localHistoryRevision++
                }
                catch (failure: CancellationException) { throw failure }
                catch (failure: Exception) { notice = "Local history was not saved: ${failure.message}" }
            }
            refreshLocalTranscript()
        }
    }

    private suspend fun clearLocalTranscript(selected: String) {
        localChatMutex.withLock {
            // Fence already queued originals before the IO suspension; new replies may arrive while clearing.
            unsavedLocalMessages.remove(selected)
            withContext(Dispatchers.IO) { localChatHistory.clear(selected) }
            localHistoryRevision++
        }
        refreshLocalTranscript()
    }

    private val acceptedActions = mutableSetOf<String>()
    private val declinedActions = mutableSetOf<String>()
    private val pendingSpeechTasks = mutableMapOf<String, Long>()
    private val pendingSpeechWorkflows = mutableMapOf<String, Long>()
    private val spokenWorkflowMessages = mutableSetOf<String>()
    private val spokenAcknowledgements = mutableSetOf<String>()
    private var replySession = 0L
    private val pendingReplies = PendingReplies()
    private var replyWaitStartedAt by mutableStateOf<Long?>(null)
    private val stateRefreshWake = Channel<Unit>(Channel.CONFLATED)
    private val voiceLaunch = VoiceLaunchGate()
    private var handsFreeAfterPermission = true
    private var mascotGrantPending = false
    private var mascotNotificationPending = false
    private var overlayGranted by mutableStateOf(false)
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        voiceLaunch.permissionResult(granted)
        if (!granted) { voiceQuestionTarget = null; voiceIntakeTarget = null; notice = "Microphone access was not granted. You can still type." }
        resumeVoiceLaunch()
    }
    private val projectAlertsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val saved = identity
        if (saved != null && granted && usageAllowed()) { ProjectAttention.setEnabled(this, saved, true); projectAlertsEnabled = true; ProjectAttention.update(this, saved, state.optJSONObject("attention")) }
        else { projectAlertsEnabled = false; notice = "Project alerts need Android notifications and permitted project access. Questions remain visible in Nakama." }
    }
    private val mascotPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        mascotNotificationPending = false
        if (granted && foreground) startMascot()
        else if (granted) mascotGrantPending = true
        else { mascotGrantPending = false; notice = "Allow Nakama notifications in Android settings so the mascot has a visible Stop control." }
    }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        notice = "Permission choices saved. Request the action again to use newly granted permissions."
    }
    private val foundationPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { choices ->
        val action = foundationPermissionAction; foundationPermissionAction = null
        if (foreground && action != null && choices.values.any { it }) foundationAction(action, false, foundationPermissionMode)
        else notice = "Permission choices saved. Open Tools and start the feature when ready."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vault = PairingVault(this)
        identity = vault.load()
        localChatHistory = LocalChatHistory(java.io.File(noBackupFilesDir, "local-chat-history"))
        localHistoryBlocked = getSharedPreferences("local_chat_access", MODE_PRIVATE).getBoolean(LocalChatHistory.scope(identity), false)
        lifecycleScope.launch { refreshLocalTranscript(); while (true) { delay(60_000); if (foreground) refreshLocalTranscript() } }

        projectAlertsEnabled = ProjectAttention.enabled(this, identity)
        val prefs = getSharedPreferences("nakama_preferences", MODE_PRIVATE)
        reduceMotion = prefs.getBoolean("reduceMotion", false)
        confirmActions = prefs.getBoolean("confirmActions", false)
        themeChoice = prefs.getString("theme", "System") ?: "System"
        mascotGrantPending = savedInstanceState?.getBoolean("mascotGrantPending") == true
        voice = VoiceController(this, ::acceptVoiceText, { voiceState = it; MoteWorkSignals.setVoiceState("foreground", when { it.startsWith("Listening") || it.startsWith("Starting microphone") -> MoteVoiceState.LISTENING; it.startsWith("Speaking") -> MoteVoiceState.SPEAKING; else -> MoteVoiceState.IDLE }); if (it == "Ready") stateRefreshWake.trySend(Unit) })
        registerReceiver(screenOffReceiver, android.content.IntentFilter(Intent.ACTION_SCREEN_OFF), android.content.Context.RECEIVER_NOT_EXPORTED)
        handleIntent(intent)
        setContent { NakamaApp() }
        if (startWithVoice) {
            tab = "Chat"
            // Recreation must not restart a microphone the owner already stopped.
            if (savedInstanceState == null) voiceLaunch.request()
        }
        lifecycleScope.launch {
            while (true) {
                if (foreground && identity != null) refreshConversation()
                val interval = ReplyPolling.delayMs(foreground && chatAllowed(), replyWaitStartedAt, SystemClock.elapsedRealtime())
                withTimeoutOrNull(interval) { stateRefreshWake.receive() }
            }
        }
        // A slow phone-action fetch/receipt must never hold up an incoming spoken reply.
        lifecycleScope.launch {
            while (true) {
                if (foreground && identity != null) pollActions()
                delay(ReplyPolling.IDLE_MS)
            }
        }
    }
    override fun onResume() {
        super.onResume(); foreground = true
        lifecycleScope.launch { refreshLocalTranscript() }
        WakeWordService.foregroundCommand = { text -> if (foreground) { voice.prepareWakeReply(); acceptVoiceText(text) } }
        runCatching { LocalTimers.restore(this) }
        overlayGranted = Settings.canDrawOverlays(this)
        if (mascotGrantPending && !mascotNotificationPending) {
            mascotGrantPending = false
            if (overlayGranted) startMascot() else notice = "The floating mascot is off. Enable Display over other apps to show it."
        }
        if (getSharedPreferences("nakama_preferences", MODE_PRIVATE).getBoolean("wakeEnabled", false) && !WakeWordService.running && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            runCatching { ContextCompat.startForegroundService(this, Intent(this, WakeWordService::class.java)) }
        }
        resumeVoiceLaunch()
        // The first short utterance must not race the background refresh interval.
        if (identity != null) stateRefreshWake.trySend(Unit)
        consumeWakeCommand()
    }
    override fun onPause() { foreground = false; WakeWordService.foregroundCommand = null; if (!voiceLaunch.awaitingPermissionResult) { voiceQuestionTarget = null; voiceIntakeTarget = null }; voiceLaunch.pause(); handoffSpokenReplies(); voice.pauseCapture(); super.onPause() }
    override fun onDestroy() { unregisterReceiver(screenOffReceiver); voice.close(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) { outState.putBoolean("mascotGrantPending", mascotGrantPending); super.onSaveInstanceState(outState) }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); handleIntent(intent)
        if (startWithVoice) { tab = "Chat"; automatic = true; showAdvanced = false; handsFreeAfterPermission = true; voiceLaunch.request(); resumeVoiceLaunch() }
    }
    private fun handleIntent(intent: Intent) {
        if (this is FoundationEntryActivity) {
            intent.getStringExtra("foundation_page")?.takeIf { it in listOf("Tasks", "Clock", "Monitoring", "Dynamic upgrade", "Routines", "Agent office", "Browser", "Project setup", "Account setup", "Skills", "Core Memory", "Remote PC", "Location", "Wake word") }?.let { foundationPage = it; tab = "Tools"; intent.removeExtra("foundation_page") }
            val alert = intent.getStringExtra("attention_id"); val alertScope = intent.getStringExtra("attention_scope")
            if (alert != null && alert.length in 1..300 && alertScope?.matches(Regex("[a-f0-9]{64}")) == true) pendingAttention = Triple(alert, alertScope, intent.getBooleanExtra("attention_voice", false))
            intent.removeExtra("attention_id"); intent.removeExtra("attention_scope"); intent.removeExtra("attention_voice")
            if (pendingAttention != null) stateRefreshWake.trySend(Unit)
            intent.getStringExtra("wake_command")?.take(24_000)?.let { pendingWakeCommand = it; pendingWakeCapturedAt = intent.getLongExtra("wake_captured_at", 0); intent.removeExtra("wake_command"); intent.removeExtra("wake_captured_at") }
            if (foreground) consumeWakeCommand()
        }
        if (intent.getBooleanExtra("stop_control", false)) { NakamaAccessibilityService.stopSession(); notice = "Phone control stopped."; tab = "Device" }
        if (intent.getBooleanExtra("open_chat", false)) tab = "Chat"
    }
    private fun consumeWakeCommand() {
        val command = pendingWakeCommand ?: return
        pendingWakeCommand = null
        getSystemService(android.app.NotificationManager::class.java).cancel(74)
        if (WakeWordService.running && WakeCommandPolicy.fresh(pendingWakeCapturedAt, SystemClock.elapsedRealtime())) acceptVoiceText(command)
        else notice = "That wake command expired. Say it again when ready."
    }
    private fun preference(name: String, value: Boolean) { getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putBoolean(name, value).apply() }
    private fun launch(showWork: Boolean = true, block: suspend () -> Unit) {
        lifecycleScope.launch {
            busy = true
            val moteWork = if (showWork) MoteWorkSignals.beginLocalWork() else null
            try { block() } catch (error: Exception) { notice = error.message ?: "Something went wrong. Try again." }
            finally { busy = false; moteWork?.let(MoteWorkSignals::endLocalWork) }
        }
    }
    private suspend fun api(method: String, path: String, body: JSONObject? = null): JSONObject {
        val saved = identity ?: error("Pair your Control Center first.")
        return withContext(Dispatchers.IO) { HostClient(saved).request(method, path, body) }
    }
    private fun clearHostContent(blockLocal: Boolean = false) {
        if (blockLocal && identity != null) blockLocalHistory(true)
        else localHistoryBlocked = getSharedPreferences("local_chat_access", MODE_PRIVATE).getBoolean(LocalChatHistory.scope(identity), false)

        MoteWorkSignals.clearHost()
        monitoringDrafts.clear(); maintenanceDrafts.clear(); PhoneMonitorObserver.stop(this)
        stateRequestGeneration++
        state = JSONObject(); stateIdentity = null; selectedProject = ""; focusedWorkflowId = null; focusedIntakeId = null; voiceQuestionTarget = null; voiceIntakeTarget = null; connectionRequestId = null; checksProjectId = null; githubProjectId = null; filesProjectId = null; browserSessionId = null; importGithub = false
        focusedWorkflowId = null; focusedIntakeId = null; connectionRequestId = null; questionDictation = null; intakeDictation = null; voiceQuestionTarget = null; voiceIntakeTarget = null; ProjectAttention.clear(this); projectAlertsEnabled = ProjectAttention.enabled(this, identity)
        stopService(Intent(this, DeviceLocationService::class.java)); PhoneAlarmScheduler.clear(this); alarmRevision = null
        pendingAction = null; appSelection = null; acceptedActions.clear(); declinedActions.clear()
        clearPendingReplies(); localMessages.clear(); voice.stop()
        lifecycleScope.launch { refreshLocalTranscript() }
    }
    private fun hostFailure(saved: HostIdentity, error: Exception) {
        if (identity != saved) return
        stateIdentity = null
        MoteWorkSignals.clearHost(saved)
        voiceQuestionTarget = null; voiceIntakeTarget = null; ProjectAttention.clear(this)
        clearPendingReplies(); voice.stop()
        if (error is HostException && error.status in listOf(401, 403)) {
            clearHostContent(blockLocal = true)
            connection = if (error.status == 401) "Pairing revoked or expired" else "Device access changed"
            NakamaAccessibilityService.stopSession()
        } else connection = "Offline · check your PC and private connection"
    }
    private suspend fun refreshSnapshot(saved: HostIdentity): JSONObject? = stateRefreshMutex.withLock {
        if (identity != saved) return@withLock null
        val generation = ++stateRequestGeneration
        val moteRequestedAt = SystemClock.elapsedRealtime()
        try {
            val next = withContext(Dispatchers.IO) { HostClient(saved).request("GET", "/api/state").also { vault.rememberEndpoints(saved, it) } }
            if (identity != saved || generation != stateRequestGeneration) return@withLock null
            val previouslyAllowed = chatAllowed()
            state = next; stateIdentity = saved
            MoteWorkSignals.updateHost(saved, next, moteRequestedAt)
            if (selectedProject.isNotBlank() && next.objects("projects").none { it.optString("id") == selectedProject }) selectedProject = ""
            connection = "Connected to ${saved.name}"
            if (localHistoryBlocked != !chatAllowed()) { blockLocalHistory(!chatAllowed()); localMessages.clear(); lifecycleScope.launch { refreshLocalTranscript() } }
            projectAlertsEnabled = ProjectAttention.enabled(this, saved)
            if (usageAllowed()) ProjectAttention.update(this, saved, next.optJSONObject("attention")) else ProjectAttention.clear(this)
            if (!usageAllowed()) { autonomousTaskDrafts.clear(); monitoringDrafts.clear(); maintenanceDrafts.clear(); PhoneMonitorObserver.stop(this, detail = "Shared phone access ended; observation is off.") }
            if (!chatAllowed()) { clearPendingReplies(); WakeWordService.stopReply?.invoke(); if (previouslyAllowed) voice.stop() }
            if (!usageAllowed()) { pendingSpeechWorkflows.clear(); spokenWorkflowMessages.clear(); pendingReplies.resolve(pendingReplies.ids.filter { it.startsWith("workflow:") }.toSet()); replyWaitStartedAt = pendingReplies.oldestStartedAt; stopService(Intent(this, DeviceLocationService::class.java)); PhoneAlarmScheduler.clear(this); alarmRevision = null }
            else if (PhoneAlarmScheduler.enabled(this, saved.deviceId)) {
                val routines = next.optJSONObject("routineBoard")?.objects("routines").orEmpty()
                val revision = PhoneAlarmScheduler.revision(this, routines)
                if (revision != alarmRevision) {
                    try { syncPhoneAlarms(saved, routines); if (identity == saved && usageAllowed()) alarmRevision = revision }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) {
                        if (failure is HostException && failure.status in listOf(401, 403)) { PhoneAlarmScheduler.clear(this); alarmRevision = null; throw failure }
                        notice = "Phone alarm sync needs attention: ${failure.message}"
                    }
                }
            }
            if (foreground) applyPendingAttention(saved, next)
            return@withLock next
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (identity != saved || generation != stateRequestGeneration) return@withLock null
            hostFailure(saved, error)
            throw error
        }
    }
    private suspend fun checkRequest(saved: HostIdentity, method: String, path: String, body: JSONObject?): JSONObject {
        check(identity == saved && stateIdentity == saved) { "The connection changed. Refresh before requesting a check." }
        return withContext(Dispatchers.IO) { HostClient(saved).request(method, path, body) }
    }
    private suspend fun refreshCheckState(saved: HostIdentity) {
        check(identity == saved) { "The pairing changed. Open project checks again." }
        refreshSnapshot(saved)
    }
    private suspend fun refresh() {
        refreshConversation()
        pollActions()
    }
    private fun handoffSpokenReplies() {
        val saved = identity ?: return
        val tasks = pendingSpeechTasks.filterValues { it == replySession }.keys.toList()
        val workflows = pendingSpeechWorkflows.filterValues { it == replySession }.keys.toList()
        val receipts = mutableListOf<JSONObject>()
        if (tasks.isNotEmpty()) receipts += JSONObject().put("deliveryDeviceId", saved.deviceId).put("taskIds", org.json.JSONArray(tasks))
        workflows.forEach { receipts += JSONObject().put("deliveryDeviceId", saved.deviceId).put("workflowId", it).put("spokenMessageIds", org.json.JSONArray(spokenWorkflowMessages.toList())) }
        if (receipts.isNotEmpty() && WakeWordService.continueReplies?.invoke(saved, receipts) == true) {
            tasks.forEach(pendingSpeechTasks::remove); workflows.forEach(pendingSpeechWorkflows::remove)
            pendingReplies.resolve((tasks + workflows.map { "workflow:$it" }).toSet()); replyWaitStartedAt = pendingReplies.oldestStartedAt
        }
    }
    private fun clearPendingReplies() { ++replySession; navigationReceipts.invalidate(); appSelection = null; pendingSpeechTasks.clear(); pendingSpeechWorkflows.clear(); spokenWorkflowMessages.clear(); spokenAcknowledgements.clear(); pendingReplies.clear(); replyWaitStartedAt = null }
    private suspend fun refreshConversation() {
        val saved = identity ?: return
        val voiceSession = replySession
        val snapshot = try { refreshSnapshot(saved) ?: return }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { return }
        try {
            val tasks = pendingSpeechTasks.filterValues { it == voiceSession }.keys.take(50)
            val workflows = pendingSpeechWorkflows.filterValues { it == voiceSession }.keys.take(50)
            val receipts = if (chatAllowed() && (tasks.isNotEmpty() || workflows.isNotEmpty())) withContext(Dispatchers.IO) {
                HostClient(saved).request("POST", "/api/chats/receipts", JSONObject().put("taskIds", org.json.JSONArray(tasks)).put("workflowIds", org.json.JSONArray(workflows)))
            } else JSONObject()
            if (identity != saved || replySession != voiceSession || !chatAllowed()) return
            val fresh = if (receipts.has("messages")) refreshSnapshot(saved) ?: return else snapshot
            if (identity != saved || replySession != voiceSession || !chatAllowed()) return
            val merged = (fresh.objects("messages") + receipts.objects("messages")).distinctBy { it.optString("id") }.filter { DeviceDelivery.addressedTo(it, saved.deviceId) }
            deliverPendingReplies(JSONObject(fresh.toString()).put("messages", org.json.JSONArray(merged)), voiceSession)
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) { hostFailure(saved, error) }
    }
    private fun deliverPendingReplies(snapshot: JSONObject, voiceSession: Long) {
            val deviceId = identity?.deviceId ?: return
            val replies = snapshot.objects("messages").filter { it.optString("role") == "assistant" && DeviceDelivery.addressedTo(it, deviceId) }
            val finished = snapshot.objects("tasks").filter { DeviceDelivery.addressedTo(it, deviceId) && ReplyPolling.finished(it.optString("status")) }.map { it.optString("id") }
            val workflows = if (usageAllowed()) snapshot.objects("projectWorkflows").filter { DeviceDelivery.addressedTo(it, deviceId) } else emptyList()
            val settledWorkflows = workflows.filter { it.optString("status") != "running" }.map { "workflow:${it.optString("id")}" }
            pendingReplies.resolve((replies.map { it.optString("taskId") } + finished + settledWorkflows).toSet())
            replyWaitStartedAt = pendingReplies.oldestStartedAt
            if (foreground && chatAllowed() && replySession == voiceSession && voice.replyPlaybackAvailable) {
                val matching = replies.filter { pendingSpeechTasks[it.optString("taskId")] == voiceSession }
                val reply = matching.firstOrNull { it.opt("pipelineIntermediate") != true }
                val workflowReplies = replies.filter { message ->
                    val id = message.optString("workflowId")
                    val latestQuestion = replies.lastOrNull { it.optString("workflowId") == id && it.optString("kind") == "project_questions" }
                    val relevant = message.optString("kind") == "project_delivery" ||
                        (message.optString("kind") == "project_questions" && workflows.any { it.optString("id") == id && it.optString("status") == "awaiting_answers" } && message.optString("id") == latestQuestion?.optString("id"))
                    usageAllowed() && pendingSpeechWorkflows[id] == voiceSession && relevant && message.optString("id").isNotBlank() && message.optString("id") !in spokenWorkflowMessages
                }
                val workflowReply = workflowReplies.firstOrNull()
                val acknowledgement = replies.firstOrNull { message ->
                    val ids = message.optJSONArray("taskIds")
                    message.optString("kind") == "task_ack" && message.optString("id").isNotBlank() && message.optString("id") !in spokenAcknowledgements &&
                        ((ids != null && (0 until ids.length()).any { pendingSpeechTasks[ids.optString(it)] == voiceSession }) || pendingSpeechWorkflows[message.optString("workflowId")] == voiceSession)
                }
                val nextReply = workflowReply ?: reply ?: acknowledgement
                if (nextReply != null) {
                    if (nextReply === workflowReply) spokenWorkflowMessages += nextReply.optString("id")
                    else if (nextReply === reply) pendingSpeechTasks.remove(nextReply.optString("taskId"))
                    else spokenAcknowledgements += nextReply.optString("id")
                    voice.speak(nextReply.optString("content"))
                }
                matching.filter { it.opt("pipelineIntermediate") == true }.forEach { pendingSpeechTasks.remove(it.optString("taskId")) }
                workflows.filter { it.optString("status") in listOf("completed", "failed", "stopped", "interrupted", "needs_attention") }.forEach {
                    val id = it.optString("id")
                    val waitingDelivery = replies.any { message -> message.optString("workflowId") == id && message.optString("kind") == "project_delivery" && message.optString("id") !in spokenWorkflowMessages }
                    if (!waitingDelivery && pendingSpeechWorkflows.remove(id) == voiceSession && it.optString("status") != "completed" && workflowReply == null) {
                        localReply(it.optString("error").ifBlank { "The project needs your attention. Review its status before continuing." }, ReplyMode.VOICE)
                    }
                }
                if (reply == null) {
                    val failed = snapshot.objects("tasks").lastOrNull { DeviceDelivery.addressedTo(it, deviceId) && pendingSpeechTasks[it.optString("id")] == voiceSession && ReplyPolling.unsuccessful(it.optString("status")) }
                    failed?.let { pendingSpeechTasks.remove(it.optString("id")); localReply(it.optString("error").ifBlank { "That task stopped. Tap Talk when you are ready." }, ReplyMode.VOICE) }
                }
            }
    }
    private suspend fun pollActions() {
        val saved = identity ?: return
        if (!foreground || stateIdentity != saved || !connection.startsWith("Connected")) return
        if (!actionsRefreshMutex.tryLock()) return
        try {
            if (usageAllowed()) lifecycleScope.launch { InstalledApps.sync(applicationContext, saved) }
            val outcomes = ActionInbox.poll(this, saved, canExecute = { action ->
                val id = action.optString("id")
                val shouldConfirm = confirmActions || state.optJSONObject("config")?.optBoolean("confirmOrdinaryActions") == true
                if (identity != saved || stateIdentity != saved) false
                else if (action.optString("type").startsWith("ui_")) false
                else if (!foreground) false
                else if (shouldConfirm && id !in acceptedActions && id !in declinedActions) {
                    if (pendingAction == null) pendingAction = action
                    false
                }
                else true
            }) { action ->
                val id = action.optString("id")
                if (identity != saved || stateIdentity != saved || !foreground) ActionResult("blocked", "The pairing or foreground session changed before this action could run.")
                else if (declinedActions.remove(id)) ActionResult("blocked", "The owner declined this action on the phone.")
                else { acceptedActions.remove(id); PhoneActions(this).execute(action) }
            }
            if (identity == saved) outcomes.lastOrNull()?.let { notice = it.message }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) {
            // State refresh owns connection health. An unrelated delayed action fetch must not
            // stop a healthy conversation; a revoked token still immediately clears access.
            if (error is HostException && error.status == 401) hostFailure(saved, error)
            else if (identity == saved && foreground) notice = "Could not check phone actions. Nakama will check again while open."
        } finally { actionsRefreshMutex.unlock() }
    }
    private fun pair(payload: String, deviceName: String) = launch {
        val json = JSONObject(payload.trim())
        val url = PairingValidation.deviceEndpoint(json.getString("url"))
        val fingerprint = PairingValidation.fingerprint(json.getString("fingerprint"))
        val ticket = json.getString("ticket")
        require(deviceName.trim().length in 1..80) { "Enter a device name between 1 and 80 characters." }
        val expiresAt = json.optString("expiresAt")
        if (expiresAt.isNotBlank()) require(Instant.parse(expiresAt).isAfter(Instant.now())) { "That pairing ticket has expired. Create a new one on your PC." }
        val response = try {
            withContext(Dispatchers.IO) {
                HostClient(url, fingerprint).request("POST", "/api/pair", JSONObject().put("ticket", ticket).put("name", deviceName.trim()).put("platform", "android")
                    .put("capabilities", org.json.JSONArray(listOf("call", "sms", "calendar", "contacts_search", "open_app", "whatsapp_message", "ui_read", "ui_tap", "ui_type", "ui_scroll", "ui_back"))))
            }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) { throw IllegalStateException(PairingHelp.connectionError(error), error) }
        val saved = HostIdentity(url, fingerprint, response.getString("token"), response.getString("deviceId"), response.optString("hostName", "Control Center"))
        vault.save(saved); identity = saved; clearHostContent(); notice = "Paired securely. Your desktop can revoke access at any time."; tab = "Home"
        refresh()
    }
    private fun chatAllowed(): Boolean {
        val saved = identity ?: return false
        if (stateIdentity != saved || !connection.startsWith("Connected")) return false
        val device = state.objects("devices").find { it.optString("id") == saved.deviceId } ?: return false
        return device.optJSONObject("permissions")?.opt("googleAccess") != false && device.optJSONObject("permissions")?.opt("projectAccess") != false
    }
    private fun usageAllowed(): Boolean = chatAllowed() && state.objects("devices").find { it.optString("id") == identity?.deviceId }?.optJSONObject("permissions")?.opt("projectAccess") != false
    private fun updateWorkflow(workflowId: String, action: String, body: JSONObject) {
        val dictated = questionDictation
        val answerByVoice = dictated?.workflowId == workflowId && body.toString().contains(JSONObject.quote(dictated.text))
        questionDictation = null
        if (action == "answers") WakeWordService.discardWorkflow?.invoke(workflowId)
        val saved = identity ?: return
        val voiceSession = replySession
        launch {
            check(workflowId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid project workflow." }
            check(identity == saved && usageAllowed()) { "Reconnect and enable Google and project access before continuing." }
            val workflow = state.objects("projectWorkflows").firstOrNull { it.optString("id") == workflowId }
            check(workflow != null && (action == "answers" || workflow.optString("requestedBy") == saved.deviceId)) { "Stop this workflow from its original device or your PC." }
            checkRequest(saved, "POST", "/api/project-workflows/$workflowId/$action", body)
            if (identity != saved || !usageAllowed()) return@launch
            if (action == "answers" && foreground && replySession == voiceSession) {
                pendingSpeechWorkflows.remove(workflowId)
                pendingReplies.add(listOf("workflow:$workflowId"), SystemClock.elapsedRealtime()); replyWaitStartedAt = pendingReplies.oldestStartedAt
                if (answerByVoice) pendingSpeechWorkflows[workflowId] = voiceSession
            }
            stateRefreshWake.trySend(Unit)
            refreshSnapshot(saved)
        }
    }
    private fun sendChat(mode: ReplyMode = ReplyMode.TEXT) {
        var message = draft.trim()
        if (message.isBlank()) return
        chatSubmission = ChatSubmission(java.util.UUID.randomUUID().toString(), message)
        DeviceCommandRouting.parse(message)?.let { directed ->
            if (directed.error.isNotBlank()) { draft = ""; recordLocalMessage("user", message); localReply(directed.error, mode); return }
            if (DeviceCommandRouting.isThisDevice(directed.targetName)) { message = directed.originalCommand; draft = message; chatSubmission = chatSubmission?.copy(text = message) }
            else {
                if (busy) { notice = "Wait for the current request to be accepted before redirecting another command."; return }
                draft = ""
                recordLocalMessage("user", message)
                sendDirectedCommand(directed, mode)
                return
            }
        }
        LocalClockCommands.parse(message)?.let { command ->
            draft = ""
            recordLocalMessage("user", message)
            val reply = LocalClockActions.execute(this, command)
            if (reply.openClock) openTools("Clock")
            localReply(reply.text, mode)
            return
        }
        NavigationPolicy.parse(message)?.let { draft = ""; recordLocalMessage("user", message); navigate(it, mode = mode); return }
        val foundation = FoundationPolicy.command(message)
        if (foundation != null) { draft = ""; recordLocalMessage("user", message); handleFoundationCommand(foundation, mode); return }
        if (busy) { notice = "This request is still being accepted. You can navigate while it finishes."; return }
        val phoneCommand = PhoneCommandParser.parse(message)
        if (phoneCommand != null) {
            draft = ""; tab = "Chat"
            recordLocalMessage("user", message)
            launch { processPhoneCommand(phoneCommand, mode) }
            return
        }
        val saved = identity ?: run { draft = ""; recordLocalMessage("user", message); voice.stop(); localReply("Pair your PC before using AI chat. Direct phone tools remain available.", mode); return }
        val voiceSession = voice.session
        val deliverySession = replySession
        val navigationTicket = navigationReceipts.begin()
        launch {
            val body = ChatRequest.body(message, selectedProject, automatic, selectedProvider, selectedModel, effort, chatMode,
                if (team) state.objects("providers").filter { it.optString("id") in listOf("codex", "claude") }.map { it.getString("id") } else emptyList()).put("timeZone", ZoneId.systemDefault().id).put("requestId", java.util.UUID.randomUUID().toString()).put("inputMode", if (mode == ReplyMode.VOICE) "voice" else "text")
            try {
                if (stateIdentity != saved || !connection.startsWith("Connected")) refreshSnapshot(saved)
                check(identity == saved && chatAllowed()) { "Connect your PC and enable this device's Google and project access before using AI chat. Direct phone tools remain available." }
                val response = checkRequest(saved, "POST", "/api/chat", body)
                if (identity != saved || !chatAllowed() || !DeviceDelivery.addressedTo(response, saved.deviceId)) return@launch
                if (replySession == deliverySession && (foreground || mode == ReplyMode.VOICE)) {
                    val ids = response.optJSONArray("taskIds")
                    val submitted = if (ids != null) (0 until ids.length()).map { ids.optString(it) }.filter { it.isNotBlank() } else emptyList()
                    pendingReplies.add(submitted, SystemClock.elapsedRealtime()); replyWaitStartedAt = pendingReplies.oldestStartedAt
                    if (mode == ReplyMode.VOICE) submitted.forEach { pendingSpeechTasks[it] = deliverySession }
                    val workflowId = response.optString("workflowId")
                    if (workflowId.isNotBlank() && usageAllowed()) {
                        pendingReplies.add(listOf("workflow:$workflowId"), SystemClock.elapsedRealtime()); replyWaitStartedAt = pendingReplies.oldestStartedAt
                        if (mode == ReplyMode.VOICE) pendingSpeechWorkflows[workflowId] = deliverySession
                    }
                }
                if (voice.session == voiceSession && draft.trim() == message) draft = ""
                AlarmReceiptPolicy.request(response, saved.deviceId)?.let { alarm ->
                    refreshSnapshot(saved)
                    if (identity == saved && chatAllowed() && replySession == deliverySession) {
                        val feedback = PhoneAlarmScheduler.feedback(this@MainActivity, saved.deviceId, alarm, state.optJSONObject("routineBoard")?.objects("routines").orEmpty())
                        if (feedback != null) {
                            response.put("reply", response.optString("reply") + " " + feedback.text)
                            if (feedback.needsSetup && foreground) applyNavigationReceipt(JSONObject().put("target", "routines"), navigationTicket)
                        }
                    }
                }
                if (identity != saved || !chatAllowed() || replySession != deliverySession) return@launch
                val immediate = response.optString("reply")
                val continued = !foreground && mode == ReplyMode.VOICE && replySession == deliverySession && WakeWordService.continueReplies?.invoke(saved, listOf(response)) == true
                if (continued) {
                    response.optJSONArray("taskIds")?.let { ids -> (0 until ids.length()).forEach { pendingSpeechTasks.remove(ids.optString(it)) } }
                    pendingSpeechWorkflows.remove(response.optString("workflowId"))
                }
                if (!continued && immediate.isNotBlank() && voice.session == voiceSession && mode == ReplyMode.VOICE) voice.speak(immediate)
                val outcome = response.optJSONObject("outcome")
                if (foreground && replySession == deliverySession && outcome?.optString("type") == "navigate") applyNavigationReceipt(outcome, navigationTicket)
                if (foreground && navigationReceipts.accepts(navigationTicket) && response.optString("intakeId").isNotBlank()) { focusedIntakeId = response.optString("intakeId"); foundationPage = "Project setup"; tab = "Tools" }
                stateRefreshWake.trySend(Unit)
            } catch (error: CancellationException) { throw error
            } catch (error: Exception) {
                if (foreground && replySession == deliverySession) localReply(error.message ?: "That request could not finish. Check its status before trying again.", mode)
            }
        }
    }
    private fun sendDirectedCommand(command: DirectedDeviceCommand, mode: ReplyMode) {
        val saved = identity ?: run { localReply("Pair your PC before targeting another device. Nothing was redirected.", mode); return }
        val session = replySession
        val voiceSession = voice.session
        launch {
            try {
                if (stateIdentity != saved || !connection.startsWith("Connected")) refreshSnapshot(saved)
                check(identity == saved && usageAllowed()) { "Reconnect and enable this device's access before redirecting a command." }
                val directory = checkRequest(saved, "GET", "/api/device-targets", null)
                val target = DeviceCommandRouting.resolve(command.targetName, DeviceCommandRouting.targets(directory))
                check(foreground && identity == saved && replySession == session && (mode != ReplyMode.VOICE || voice.session == voiceSession)) { "The requesting session changed. Nothing was redirected." }
                val result = checkRequest(saved, "POST", "/api/device/commands", DeviceCommandRouting.body(command, target, java.util.UUID.randomUUID().toString()).put("inputMode", if (mode == ReplyMode.VOICE) "voice" else "text"))
                refreshSnapshot(saved)
                if (identity == saved && foreground && replySession == session && usageAllowed() && (mode != ReplyMode.VOICE || voice.session == voiceSession) && DeviceDelivery.addressedTo(result, saved.deviceId))
                    localReply(result.optString("reply").ifBlank { "Request queued for ${target.name}. Completion has not been confirmed." }, mode)
                stateRefreshWake.trySend(Unit)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { if (identity == saved && foreground && replySession == session && (mode != ReplyMode.VOICE || voice.session == voiceSession)) localReply(error.message ?: "The other-device request failed. Nothing was run on this phone.", mode) }
        }
    }
    private fun cancelQuestionVoice() {
        if (voiceQuestionTarget != null || voiceIntakeTarget != null) { voiceLaunch.cancel(); if (::voice.isInitialized) voice.stop() }
        voiceQuestionTarget = null; voiceIntakeTarget = null
    }
    private fun editDraft(text: String, fromVoice: Boolean = false) { if (!fromVoice) voice.stop(); navigationReceipts.invalidate(); appSelection = null; cancelQuestionVoice(); draft = text }
    private fun acceptVoiceText(text: String) {
        val intakeTarget = voiceIntakeTarget
        if (intakeTarget != null) {
            voiceIntakeTarget = null
            val intake = (state.objects("projectIntakes") + state.objects("projectDeliveries")).firstOrNull { it.optString("id") == intakeTarget.first && it.optString("status") == "awaiting_answers" }
            if (foreground && usageAllowed() && intake?.objects("questions")?.any { it.optString("id") == intakeTarget.second } == true) {
                intakeDictation = QuestionDictation(System.nanoTime(), intakeTarget.first, intakeTarget.second, text.take(6000)); notice = "Setup answer filled in. Review it before saving."
            } else notice = "That setup changed. Review its current questions."
            return
        }
        val question = voiceQuestionTarget
        if (question != null) {
            voiceQuestionTarget = null
            val workflow = state.objects("projectWorkflows").firstOrNull { it.optString("id") == question.first && it.optString("status") == "awaiting_answers" }
            if (foreground && usageAllowed() && workflow?.objects("questions")?.any { it.optString("id") == question.second && it.optString("answer").isBlank() } == true) {
                questionDictation = QuestionDictation(System.nanoTime(), question.first, question.second, text.take(6000)); notice = "Voice answer filled in. Review it, then send the answers to your manager."
            } else notice = "That question changed. Review the current questions before answering."
            return
        }
        editDraft(text, fromVoice = true); sendChat(ReplyMode.VOICE)
    }
    private fun beginQuestionVoice(workflowId: String, questionId: String) {
        if (!foreground || !usageAllowed()) return
        val workflow = state.objects("projectWorkflows").firstOrNull { it.optString("id") == workflowId && it.optString("status") == "awaiting_answers" } ?: return
        if (workflow.objects("questions").none { it.optString("id") == questionId && it.optString("answer").isBlank() }) return
        focusedWorkflowId = workflowId; tab = "Chat"; voiceIntakeTarget = null; voiceQuestionTarget = workflowId to questionId; handsFreeAfterPermission = false
        notice = "Dictate this question's answer. Nothing is sent until you review and submit it."
        voiceLaunch.request(); resumeVoiceLaunch()
    }
    private fun beginIntakeVoice(intakeId: String, questionId: String) {
        if (!foreground || !usageAllowed()) return
        val intake = (state.objects("projectIntakes") + state.objects("projectDeliveries")).firstOrNull { it.optString("id") == intakeId && it.optString("status") == "awaiting_answers" } ?: return
        if (intake.objects("questions").none { it.optString("id") == questionId }) return
        focusedIntakeId = intakeId; foundationPage = "Project setup"; tab = "Tools"; voiceQuestionTarget = null; voiceIntakeTarget = intakeId to questionId; handsFreeAfterPermission = false
        notice = "Dictate the selected setup answer, then review and save it."; voiceLaunch.request(); resumeVoiceLaunch()
    }
    private fun applyPendingAttention(saved: HostIdentity, snapshot: JSONObject) {
        val pending = pendingAttention ?: return
        pendingAttention = null
        if (pending.second != AttentionPolicy.scope(saved) || !usageAllowed()) { notice = "This notification belongs to a different pairing or access is no longer available."; return }
        val item = AttentionPolicy.forDevice(snapshot.optJSONObject("attention"), saved.deviceId).firstOrNull { it.id == pending.first }
        if (item == null) { notice = "This request is already resolved or no longer available."; return }
        when {
            item.monitorId.isNotBlank() || item.selfMaintenanceId.isNotBlank() -> {
                voiceLaunch.cancel(); handsFreeAfterPermission = false
                val ticket = navigationReceipts.begin()
                launch {
                    try {
                        val response = checkRequest(saved, "POST", "/api/attention/open", JSONObject().put("id", item.id))
                        if (identity == saved && foreground && usageAllowed() && navigationReceipts.accepts(ticket)) {
                            val outcome = response.optJSONObject("outcome") ?: response
                            applyNavigationReceipt(outcome, ticket)
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { if (identity == saved && foreground && navigationReceipts.accepts(ticket)) notice = failure.message.orEmpty() }
                }
            }
            item.autonomousRunId.isNotBlank() -> {
                val run = snapshot.objects("autonomousTasks").firstOrNull { it.optString("id") == item.autonomousRunId && it.optString("status") == "awaiting_answers" && it.optString("requestedBy") == saved.deviceId && it.objects("questions").any { question -> question.optString("id") == item.questionId && question.optString("answer").isBlank() } }
                if (run == null) { notice = "This task question is resolved or no longer available."; return }
                val project = run.optString("projectId").takeUnless { it == "null" }.orEmpty()
                if (project.isNotBlank() && snapshot.objects("projects").none { it.optString("id") == project }) { notice = "This task's project is outside your current access."; return }
                if (autonomousTaskDrafts.identityKey != saved.deviceId) autonomousTaskDrafts.clear()
                autonomousTaskDrafts.identityKey = saved.deviceId
                autonomousTaskDrafts.focusedRunId = item.autonomousRunId
                foundationPage = "Autonomous tasks"; tab = "Tools"
                if (pending.third) { voiceLaunch.cancel(); handsFreeAfterPermission = false; notice = "Type this task answer and review it before sending. Voice answers for autonomous tasks are not available yet." }
            }
            item.connectionRequestId.isNotBlank() -> { connectionRequestId = item.connectionRequestId; foundationPage = "Account setup"; tab = "Tools" }
            item.deliveryId.isNotBlank() -> { focusedIntakeId = item.deliveryId; foundationPage = "Project setup"; tab = "Tools"; if (pending.third) beginIntakeVoice(item.deliveryId, item.questionId) }
            item.kind == "login" && BrowserInputPolicy.id(item.browserSessionId) -> { browserSessionId = item.browserSessionId; foundationPage = "Browser"; tab = "Tools" }
            item.workflowId.isNotBlank() -> {
                val workflow = snapshot.objects("projectWorkflows").firstOrNull { it.optString("id") == item.workflowId && it.optString("status") == "awaiting_answers" } ?: return
                selectedProject = workflow.optString("projectId").takeIf { value -> snapshot.objects("projects").any { it.optString("id") == value } }.orEmpty()
                focusedWorkflowId = item.workflowId; tab = "Chat"
                if (pending.third) beginQuestionVoice(item.workflowId, item.questionId)
            }
            item.intakeId.isNotBlank() -> { focusedIntakeId = item.intakeId; foundationPage = "Project setup"; tab = "Tools"; if (pending.third) beginIntakeVoice(item.intakeId, item.questionId) }
            else -> { tab = "Home"; notice = "Review this action in Activity & approvals on your PC. Phone notifications cannot approve it." }
        }
    }
    private fun applyNavigationReceipt(outcome: JSONObject, ticket: Long) {
        if (!foreground || !chatAllowed() || !navigationReceipts.accepts(ticket)) return
        val target = NavigationPolicy.hostTarget(outcome.optString("target"))
        if (target == null) { notice = "That area is available in Windows Control Center."; return }
        val project = outcome.optString("projectId")
        if (project.isNotBlank()) {
            if (outcome.optString("target") != "projects" || !usageAllowed() || state.objects("projects").none { it.optString("id") == project }) {
                notice = "That project is outside your current access. Navigation was not changed."; return
            }
            selectedProject = project
            navigate(NakamaNavigation.Page("Chat"), false)
        } else {
            val browser = outcome.optString("browserSessionId")
            if (browser.isNotBlank() && (!BrowserInputPolicy.id(browser) || target.area != "Browser" || !usageAllowed() || state.objects("devices").firstOrNull { it.optString("id") == identity?.deviceId }?.optJSONObject("permissions")?.optBoolean("browserControl") != true)) {
                notice = "This browser handoff is outside your current access."; return
            }
            navigate(target, false)
            if (browser.isNotBlank()) browserSessionId = browser
            outcome.optString("monitorId").takeIf { BrowserInputPolicy.id(it) }?.let { monitoringDrafts.focusedId = it }
            outcome.optString("selfMaintenanceId").takeIf { BrowserInputPolicy.id(it) }?.let { maintenanceDrafts.focusedId = it }
        }
    }
    private fun navigate(command: NakamaNavigation, announce: Boolean = true, mode: ReplyMode = ReplyMode.TEXT) {
        if (!foreground) return
        when (command) {
            is NakamaNavigation.Page -> {
                focusedWorkflowId = null; focusedIntakeId = null; voiceQuestionTarget = null; voiceIntakeTarget = null; connectionRequestId = null; checksProjectId = null; githubProjectId = null; filesProjectId = null; browserSessionId = null; importGithub = false; tab = command.tab; command.area?.let { foundationPage = it }
                if (announce) localReply("Opened ${command.area ?: command.tab}.", mode)
            }
            is NakamaNavigation.App -> {
                val ticket = navigationReceipts.begin()
                launch {
                val matches = withContext(Dispatchers.IO) {
                    val apps = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                        .filter { it.activityInfo.exported && it.activityInfo.enabled }.map { it.loadLabel(packageManager).toString() to it.activityInfo.packageName }
                    NavigationPolicy.matchingApps(command.label, apps)
                }
                if (!foreground || !navigationReceipts.accepts(ticket)) return@launch
                when (matches.size) {
                    0 -> localReply("No visible launchable app matches '${command.label}'. Choose its installed name in Device settings.", mode)
                    1 -> performLocalCommand(PhoneCommandParser.OpenApp(matches.single().second, matches.single().first), "", mode)
                    else -> { appSelectionTicket = ticket; appSelectionMode = mode; appSelection = matches }
                }
                }
            }
            is NakamaNavigation.Android -> {
                when (command.action) {
                    "home", "settings" -> runCatching {
                        startActivity(if (command.action == "home") Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME) else Intent(Settings.ACTION_SETTINGS))
                        localReply("Android ${command.action} opened.", mode)
                    }.onFailure { localReply("Android could not open ${command.action}.", mode) }
                    else -> localReply(NakamaAccessibilityService.navigateFromUser(command.action, NakamaAccessibilityService.sessionToken).message, mode)
                }
            }
        }
    }
    private fun openTools(page: String) { checksProjectId = null; foundationPage = page; tab = "Tools" }
    private fun handleFoundationCommand(command: FoundationCommand, mode: ReplyMode) {
        when (command) {
            is FoundationCommand.Open -> { openTools(command.page); localReply("Opened ${command.page}.", mode) }
            is FoundationCommand.Monitor -> { openTools("Remote PC"); remoteVoiceCommand = System.nanoTime() to "monitor:${command.selection}" }
            is FoundationCommand.PcInput -> { openTools("Remote PC"); remoteVoiceCommand = System.nanoTime() to "input:${JSONObject().put("kind", command.kind).put("value", command.value)}" }
            FoundationCommand.ConnectRemote -> { openTools("Remote PC"); remoteVoiceCommand = System.nanoTime() to "connect" }
            FoundationCommand.StopRemote -> { openTools("Remote PC"); remoteVoiceCommand = System.nanoTime() to "stop" }
            FoundationCommand.StartLocation -> { openTools("Location"); foundationAction("start_location", mode = mode) }
            FoundationCommand.StopLocation -> { openTools("Location"); foundationAction("stop_location", mode = mode) }
            FoundationCommand.RefreshLocation -> { openTools("Location"); foundationAction("update_location", mode = mode) }
            FoundationCommand.StartWake -> { openTools("Wake word"); foundationAction("start_wake", mode = mode) }
            FoundationCommand.StopWake -> { openTools("Wake word"); foundationAction("stop_wake", mode = mode) }
            FoundationCommand.SyncAlarms -> { openTools("Routines"); foundationAction("sync_alarms", mode = mode) }
            FoundationCommand.SilenceAlarms -> foundationAction("silence_alarms", mode = mode)
        }
        if (command is FoundationCommand.Monitor || command is FoundationCommand.PcInput || command == FoundationCommand.ConnectRemote || command == FoundationCommand.StopRemote) localReply("Opened remote controls for your request. Check the connection and action result there.", mode)
    }
    private suspend fun syncPhoneAlarms(saved: HostIdentity, routines: List<JSONObject>) {
        check(identity == saved && usageAllowed()) { "Reconnect and enable project and Google access first." }
        HostAlarmSounds.sync(this, saved, state, current = { identity == saved && usageAllowed() })
        if (identity != saved || !usageAllowed() || vault.load() != saved) { PhoneAlarmScheduler.clear(this); return }
        val receipts = PhoneAlarmScheduler.sync(this, saved.deviceId, routines)
        for (receipt in receipts) {
            if (identity != saved || !usageAllowed()) { PhoneAlarmScheduler.clear(this); return }
            val id = receipt.getString("routineId"); receipt.remove("routineId")
            checkRequest(saved, "POST", "/api/routines/$id/device-status", receipt)
        }
    }
    private fun foundationAction(action: String, requestPermissions: Boolean = true, mode: ReplyMode = ReplyMode.TEXT) {
        fun missing(permission: String) = ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
        when (action) {
            "timer_notifications" -> permissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            "timer_alarm_permission" -> startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            "timer_alert_settings" -> {
                LocalTimers.prepareNotifications(this)
                startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName).putExtra(Settings.EXTRA_CHANNEL_ID, LocalTimers.ALERT_CHANNEL))
            }
            "wake_app_settings" -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            "start_wake", "restart_wake" -> {
                if (!foreground) { notice = "Open Nakama to enable wake listening."; return }
                if (missing(Manifest.permission.RECORD_AUDIO) || missing(Manifest.permission.POST_NOTIFICATIONS)) {
                    if (requestPermissions) { foundationPermissionAction = action; foundationPermissionMode = mode; foundationPermissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)) }
                    else notice = "Microphone and notification permissions are needed for visible wake listening."
                    return
                }
                preference("wakeEnabled", true)
                voice.stop(); runCatching { ContextCompat.startForegroundService(this, Intent(this, WakeWordService::class.java).setAction(if (action == "restart_wake") "RESTART" else "START")) }.onSuccess { localReply("Wake listening requested. The listening notification confirms when it is active.", mode) }.onFailure { localReply("Android could not start wake listening: ${it.message}", mode) }
            }
            "stop_wake" -> { preference("wakeEnabled", false); stopService(Intent(this, WakeWordService::class.java)); localReply("Wake listening stopped.", mode) }
            "location_permissions" -> { foundationPermissionAction = null; foundationPermissions.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) }
            "background_location" -> { notice = "In Android permissions, choose Location. 'Allow all the time' is optional and must be granted there after foreground location access."; startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
            "start_location" -> {
                if (!foreground || !usageAllowed()) { notice = "Open Nakama, connect the PC and enable Google/project access before sharing this phone's location."; return }
                if ((missing(Manifest.permission.ACCESS_FINE_LOCATION) && missing(Manifest.permission.ACCESS_COARSE_LOCATION)) || missing(Manifest.permission.POST_NOTIFICATIONS)) {
                    if (requestPermissions) { foundationPermissionAction = action; foundationPermissionMode = mode; foundationPermissions.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)) }
                    else notice = "Location and notification permissions are needed. Approximate access shares the accuracy Android reports."
                    return
                }
                val saved = identity ?: return
                launch { checkRequest(saved, "POST", "/api/device/location/consent", JSONObject().put("enabled", true)); if (foreground && identity == saved && usageAllowed()) ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, DeviceLocationService::class.java)); refreshSnapshot(saved) }
            }
            "stop_location", "forget_location" -> {
                stopService(Intent(this, DeviceLocationService::class.java))
                val saved = identity
                if (saved != null && usageAllowed()) launch { if (action == "forget_location") checkRequest(saved, "DELETE", "/api/device/location", null) else checkRequest(saved, "POST", "/api/device/location/consent", JSONObject().put("enabled", false)); refreshSnapshot(saved) }
                else notice = "Sharing stopped on this phone. Reconnect to remove the PC's saved fix or consent."
            }
            "update_location" -> if (DeviceLocationService.running) startService(Intent(this, DeviceLocationService::class.java).setAction("REFRESH")) else { notice = "Start location sharing to request an update." }
            "sync_alarms" -> {
                val saved = identity ?: return
                if (!usageAllowed()) { notice = "Connect and enable Google/project access to sync alarms."; return }
                if (missing(Manifest.permission.POST_NOTIFICATIONS) && requestPermissions) { foundationPermissionAction = action; foundationPermissionMode = mode; foundationPermissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)); return }
                PhoneAlarmScheduler.enable(this, saved.deviceId)
                launch { syncPhoneAlarms(saved, state.optJSONObject("routineBoard")?.objects("routines").orEmpty()); refreshSnapshot(saved); localReply("Phone alarm sync finished. Check each routine's scheduling receipt; permission failures mean its alarm is not scheduled.", mode) }
            }
            "alarm_permission" -> startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            "silence_alarms" -> { PhoneAlarmScheduler.silence(this); localReply("Current Nakama alarm notifications silenced. Future scheduled alarms remain enabled.", mode) }
        }
    }
    private fun localReply(message: String, mode: ReplyMode = ReplyMode.TEXT) {
        recordLocalMessage("assistant", message)
        notice = message
        if (mode == ReplyMode.VOICE && foreground) voice.speak(message)
    }
    private suspend fun processPhoneCommand(command: PhoneCommandParser.Command, mode: ReplyMode) {
        val requestSession = voice.session
        if (command is PhoneCommandParser.Unsupported) { localReply(command.explanation, mode); return }
        if (command is PhoneCommandParser.OpenApp) { performLocalCommand(command, "", mode); return }
        val target = when (command) { is PhoneCommandParser.Call -> command.target; is PhoneCommandParser.Message -> command.target; else -> return }
        if (PhoneCommandParser.isPhoneNumber(target)) { performLocalCommand(command, target, mode); return }
        val contacts = try { withContext(Dispatchers.IO) { PhoneActions(this@MainActivity).findContacts(target) } }
            catch (error: Exception) { if (foreground && voice.session == requestSession) localReply(error.message ?: "Could not look up that contact.", mode); return }
        if (!foreground || voice.session != requestSession) return
        if (contacts.isEmpty()) { localReply("I couldn't find '$target' in your contacts. Use a more specific name or an explicit phone number.", mode); return }
        val exact = contacts.filter { it.name.equals(target, true) }
        if (exact.size == 1) performLocalCommand(command, exact.single().number, mode)
        else { contactSelectionMode = mode; contactSelection = command to if (exact.isNotEmpty()) exact else contacts }
    }
    private fun performLocalCommand(command: PhoneCommandParser.Command, number: String, mode: ReplyMode = ReplyMode.TEXT) {
        val args = JSONObject()
        val type = when (command) {
            is PhoneCommandParser.Call -> { args.put("number", number).put("direct", true); "call" }
            is PhoneCommandParser.Message -> { args.put("number", number).put("message", command.message); if (command.whatsapp) "whatsapp_message" else "sms" }
            is PhoneCommandParser.OpenApp -> { args.put("packageName", command.packageName); "open_app" }
            else -> return
        }
        val action = JSONObject().put("id", "local-${System.nanoTime()}").put("type", type).put("args", args).put("localVoice", mode == ReplyMode.VOICE)
        if (confirmActions) pendingAction = action else localReply(PhoneActions(this).execute(action).message, mode)
    }
    private fun startVoice(continuous: Boolean) {
        if (!foreground) return
        voiceQuestionTarget = null; voiceIntakeTarget = null
        tab = "Chat"; handsFreeAfterPermission = continuous
        voiceLaunch.request(); resumeVoiceLaunch()
    }
    private fun stopConversation() { WakeWordService.stopReply?.invoke(); contactSelectionMode = ReplyMode.TEXT; appSelectionMode = ReplyMode.TEXT; pendingAction?.remove("localVoice"); voiceQuestionTarget = null; voiceIntakeTarget = null; voiceLaunch.cancel(); clearPendingReplies(); voice.stop() }
    private fun resumeVoiceLaunch() {
        if (!voiceLaunch.take(foreground)) return
        WakeWordService.stopReply?.invoke()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) voice.listen(handsFreeAfterPermission)
        else { voiceLaunch.awaitingPermission(); microphonePermission.launch(Manifest.permission.RECORD_AUDIO) }
    }
    private fun startMascot() {
        if (!foreground) return
        overlayGranted = Settings.canDrawOverlays(this)
        if (!overlayGranted) {
            mascotGrantPending = true
            runCatching { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
                .onFailure { mascotGrantPending = false; notice = "Open Android Settings → Apps → Nakama → Display over other apps. Then return and tap Enable floating mascot." }
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { mascotNotificationPending = true; mascotPermission.launch(Manifest.permission.POST_NOTIFICATIONS); return }
        runCatching { ContextCompat.startForegroundService(this, Intent(this, MascotOverlayService::class.java)) }
            .onSuccess { notice = "Mote is starting. Drag to move, tap to talk, hold to hide. The notification has a Stop control." }
            .onFailure { notice = "Android could not start the floating mascot. Keep Nakama open and try again." }
    }
    private fun stopMascot() {
        mascotGrantPending = false; mascotNotificationPending = false
        NakamaAccessibilityService.stopSession()
        stopService(Intent(this, MascotOverlayService::class.java))
        notice = "Floating mascot and phone control stopped."
    }
    @Composable private fun MascotPanel() {
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AndroidView(factory = { MoteView(it) }, modifier = Modifier.size(56.dp))
                    Column(Modifier.padding(start = 10.dp)) { Text("Floating Nakama mascot", fontWeight = FontWeight.Bold); Text(if (MascotOverlayService.running) "On · tap Mote to talk" else "Off", style = MaterialTheme.typography.bodySmall) }
                }
                Text("Show Mote above other apps. Drag to move, tap to start a voice conversation, or hold to hide. Optional Nakama wake listening has its own enable and Stop controls under Tools.", style = MaterialTheme.typography.bodySmall)
                if (!overlayGranted) Text("Android needs your permission to display over other apps.", style = MaterialTheme.typography.bodySmall)
                if (MascotOverlayService.lastError.isNotBlank()) Text(MascotOverlayService.lastError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (MascotOverlayService.running) OutlinedButton(onClick = ::stopMascot) { Text("Hide mascot & stop control") }
                else Button(onClick = ::startMascot) { Text("Enable floating mascot") }
            }
        }
    }

    @Composable private fun NakamaApp() {
        val dark = themeChoice == "Dark" || (themeChoice == "System" && isSystemInDarkTheme())
        val scheme = if (dark) darkColorScheme(primary = Color(0xFF9BB9FF), secondary = Color(0xFF8EDDCB), background = Color(0xFF0D1321), surface = Color(0xFF141E30), surfaceVariant = Color(0xFF202D44))
        else lightColorScheme(primary = Color(0xFF315EB4), secondary = Color(0xFF176F5F), background = Color(0xFFF5F7FC), surface = Color.White, surfaceVariant = Color(0xFFE7EDFA))
        MaterialTheme(colorScheme = scheme, typography = Typography()) {
          NakamaMotion(reduceMotion) {
            Scaffold(bottomBar = {
                NavigationBar {
                    listOf("Home" to "⌂", "Projects" to "▦", "Chat" to "◌", "Personal" to "✉", "Tools" to "☷", "Device" to "◇").forEach { (name, icon) ->
                        NavigationBarItem(selected = tab == name, onClick = { if (name != "Projects") checksProjectId = null; if (name != "Chat") voice.stop(); tab = name }, icon = { Text(icon, fontSize = 25.sp) }, label = { Text(name) })
                    }
                }
            }) { padding ->
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.widthIn(max = 980.dp).fillMaxSize().padding(horizontal = 20.dp)) {
                        Row(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            AndroidView(factory = { MoteView(it) }, modifier = Modifier.size(48.dp))
                            Column(Modifier.weight(1f).padding(start = 10.dp)) { Text("Nakama", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(connection, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            TextButton(onClick = { launch(showWork = false) { refresh() } }, enabled = identity != null && !busy) { Text("Refresh") }
                            if (tab != "Chat") TextButton(onClick = { handsFreeAfterPermission = false; voiceLaunch.request(); resumeVoiceLaunch() }) { Text("Talk") }
                        }
                        if (busy) NakamaBusy(Modifier.fillMaxWidth())
                        if (notice.isNotBlank()) Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Text(notice, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); TextButton(onClick = { notice = "" }) { Text("OK") } }
                        }
                        MotionPage(tab, Modifier.weight(1f).fillMaxWidth()) {
                            when (tab) { "Home" -> HomeScreen(); "Projects" -> ProjectsScreen(); "Chat" -> ChatScreen(); "Personal" -> GooglePanel(identity?.deviceId, ::api); "Tools" -> ToolsScreen(); "Usage" -> ProviderUsagePanel(identity, stateIdentity == identity && identity != null && connection.startsWith("Connected"), usageAllowed(), ::checkRequest) { tab = "Home" }; else -> DeviceScreen() }
                        }
                    }
                }
            }
            pendingAction?.let { action ->
                AlertDialog(onDismissRequest = { }, title = { Text("Allow this phone action?") },
                    text = { Text("${action.optString("type")}\n\n${action.optJSONObject("args")?.toString(2) ?: ""}") },
                    confirmButton = { TextButton(onClick = { pendingAction = null; if (action.getString("id").startsWith("local-")) localReply(PhoneActions(this@MainActivity).execute(action).message, if (action.optBoolean("localVoice")) ReplyMode.VOICE else ReplyMode.TEXT) else { acceptedActions += action.getString("id"); launch(showWork = false) { refresh() } } }) { Text("Allow once") } },
                    dismissButton = { TextButton(onClick = { pendingAction = null; if (action.getString("id").startsWith("local-")) localReply("Phone action cancelled. Nothing was sent or called.", if (action.optBoolean("localVoice")) ReplyMode.VOICE else ReplyMode.TEXT) else { declinedActions += action.getString("id"); launch(showWork = false) { refresh() } } }) { Text("Decline") } })
            }
            contactSelection?.let { (command, matches) ->
                AlertDialog(onDismissRequest = { contactSelection = null }, title = { Text("Choose the recipient") }, text = {
                    LazyColumn { item { Text("Select the exact contact and number. Nakama won't guess.", Modifier.padding(bottom = 12.dp)) }; items(matches) { person ->
                        TextButton(onClick = { contactSelection = null; performLocalCommand(command, person.number, contactSelectionMode) }) { Column(Modifier.fillMaxWidth()) { Text(person.name, fontWeight = FontWeight.Bold); Text(person.number, style = MaterialTheme.typography.bodySmall) } }
                    } }
                }, confirmButton = { TextButton(onClick = { contactSelection = null; localReply("Recipient selection cancelled.", contactSelectionMode) }) { Text("Cancel") } })
            }
            appSelection?.let { matches ->
                AlertDialog(onDismissRequest = { appSelection = null }, title = { Text("Choose the exact app") }, text = {
                    Column(Modifier.verticalScroll(rememberScrollState())) { matches.forEach { (label, pkg) -> TextButton(onClick = { appSelection = null; if (foreground && navigationReceipts.accepts(appSelectionTicket)) performLocalCommand(PhoneCommandParser.OpenApp(pkg, label), "", appSelectionMode) }) { Text("$label\n$pkg") } } }
                }, confirmButton = { TextButton(onClick = { appSelection = null }) { Text("Cancel") } })
            }
          }
        }
    }

    private val autonomousTaskDrafts = AutonomousTaskDrafts()
    private val monitoringDrafts = MonitoringDrafts()
    private val maintenanceDrafts = SelfMaintenanceDrafts()

    @Composable private fun ToolsScreen() {
        if (!usageAllowed() || autonomousTaskDrafts.identityKey != identity?.deviceId) {
            autonomousTaskDrafts.clear()
            autonomousTaskDrafts.identityKey = identity?.deviceId
        }
        if (!usageAllowed() || monitoringDrafts.identityKey != identity?.deviceId) { monitoringDrafts.clear(); monitoringDrafts.identityKey = identity?.deviceId }
        if (!usageAllowed() || maintenanceDrafts.identityKey != identity?.deviceId) { maintenanceDrafts.clear(); maintenanceDrafts.identityKey = identity?.deviceId }
        key(identity) {
            FoundationsPanel(foundationPage, { foundationPage = it }, state, identity?.deviceId, usageAllowed(),
                { method, path, body ->
                    val saved = identity ?: error("Pair your PC first.")
                    check(usageAllowed()) { "Google/project access is required." }
                    val result = checkRequest(saved, method, path, body)
                    check(identity == saved && usageAllowed()) { "Access changed while loading this tool." }
                    result
                }, { identity?.let { refreshSnapshot(it) } }, { foundationAction(it) }, remoteVoiceCommand,
                { remoteVoiceCommand = remoteVoiceCommand.first to "" }, openProject = { projectId ->
                    if (usageAllowed() && state.objects("projects").any { it.optString("id") == projectId }) { selectedProject = projectId; tab = "Chat" }
                    else notice = "That project is outside your current access."
                }, connectionRequestId = connectionRequestId, browserSessionId = browserSessionId, openBrowser = { id -> browserSessionId = id; foundationPage = "Browser" }, intakeId = focusedIntakeId, intakeDictation = intakeDictation, intakeVoice = ::beginIntakeVoice, openWorkflow = { workflowId, projectId -> selectedProject = projectId; focusedWorkflowId = workflowId; tab = "Chat" }, autonomousDrafts = autonomousTaskDrafts, monitoringDrafts = monitoringDrafts, maintenanceDrafts = maintenanceDrafts)
        }
    }

    @Composable private fun HomeScreen() {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(28.dp)) {
                    Row(Modifier.fillMaxWidth().padding(22.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("A little help.\nBig possibilities.", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold); Spacer(Modifier.height(10.dp)); Text("Your projects, your devices, your AI team.", style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(18.dp)); Button(onClick = { tab = if (identity == null) "Device" else "Chat" }) { Text(if (identity == null) "Connect your PC" else "Let's make something") } }
                        AndroidView(factory = { MoteView(it) }, modifier = Modifier.size(100.dp))
                    }
                }
            }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { startVoice(true) }) { Text("Talk to Nakama") }
                OutlinedButton(onClick = { stopConversation(); tab = "Usage" }) { Text("AI usage") }
            } }
            item { OutlinedButton(onClick = { openTools("Agent office") }) { Text("Visit Agent office") } }
            item { MascotPanel() }
            item { SectionTitle("Your AI team", "Nakama chooses the right AI. Change role defaults in Control Center Settings.") }
            items(state.objects("providers").filter { it.optString("id") in listOf("codex", "claude") }) { provider ->
                InfoCard(provider.optString("name"), provider.optString("detail", provider.optString("status")), provider.optString("status"))
            }
            if (state.objects("providers").filter { it.optString("id") in listOf("codex", "claude") }.isEmpty()) item { InfoCard("Ready when you are", "Pair your Windows Control Center to see ChatGPT and Claude connection status.") }
            item { SectionTitle("Recent activity", "Keep an eye on work happening on your PC.") }
            items(state.objects("tasks").sortedByDescending { it.optString("updatedAt") }.take(5)) { task -> TaskCard(task) }
            if (state.objects("tasks").isEmpty()) item { InfoCard("A fresh start", "Your agent tasks will appear here after you send your first request.") }
            if (state.objects("approvals").any { it.optString("status") == "pending" }) item { InfoCard("A decision is waiting", "Open Activity & approvals in Control Center on your PC to review requested checks and other protected actions.", "Desktop approval") }
        }
    }
    @Composable private fun ProjectsScreen() {
        var importLocal by remember { mutableStateOf(false) }
        if (importLocal) {
            key(identity) {
                ProjectImportPanel(usageAllowed(), { method, path, body ->
                    val saved = identity ?: error("Pair your PC first.")
                    check(usageAllowed()) { "Project access is required." }
                    val result = checkRequest(saved, method, path, body)
                    check(identity == saved && usageAllowed()) { "Project access changed." }
                    result
                }, { projectId -> importLocal = false; selectedProject = projectId; tab = "Chat"; launch { refresh() } }, { importLocal = false })
            }
            return
        }
        val motion = LocalNakamaMotion.current
        filesProjectId?.let { projectId ->
            key(identity, projectId) {
                ProjectFilesPanel(projectId, state.objects("projects").firstOrNull { it.optString("id") == projectId }?.optString("name").orEmpty(), usageAllowed(), { method, path, body ->
                    val saved = identity ?: error("Pair your PC first.")
                    check(usageAllowed()) { "Google/project access is required." }
                    val result = checkRequest(saved, method, path, body)
                    check(identity == saved && usageAllowed()) { "Access changed while loading project files." }
                    result
                }, { filesProjectId = null }, { selectedProject = projectId; filesProjectId = null; tab = "Chat" })
            }
            return
        }
        if (githubProjectId != null || importGithub) {
            key(identity, githubProjectId, importGithub) {
                GithubProjectPanel(githubProjectId, state, usageAllowed(), { method, path, body ->
                    val saved = identity ?: error("Pair your PC first.")
                    check(usageAllowed()) { "Google/project access is required." }
                    val result = checkRequest(saved, method, path, body)
                    check(identity == saved && usageAllowed()) { "Access changed while loading GitHub." }
                    result
                }, { identity?.let { refreshSnapshot(it) } }) { githubProjectId = null; importGithub = false }
            }
            return
        }
        val checking = checksProjectId
        if (checking != null) {
            ProjectChecksPanel(identity, state, stateIdentity == identity && identity != null && connection.startsWith("Connected"), checking, ::checkRequest, ::refreshCheckState) { checksProjectId = null }
            return
        }
        var create by remember { mutableStateOf(false) }; var name by remember { mutableStateOf("") }; var description by remember { mutableStateOf("") }
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { SectionTitle("Your projects", "Most recently active first.") }; Button(onClick = { create = true }, enabled = identity != null) { Text("+ New") } }
            OutlinedButton(onClick = { importGithub = true }, enabled = usageAllowed()) { Text("Import from GitHub") }
            OutlinedButton(onClick = { importLocal = true }, enabled = usageAllowed()) { Text("Import a Windows folder") }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(top = 16.dp, bottom = 24.dp)) {
                items(state.objects("projects").sortedByDescending { it.optString("updatedAt") }, key = { it.optString("id") }) { project ->
                    Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = tween(MotionPolicy.duration(motion, 220))).fillMaxWidth().clickable { selectedProject = project.optString("id"); tab = "Chat" }) {
                        Column(Modifier.padding(20.dp)) {
                            Row { Text(project.optString("name"), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f)); Text("↗", color = MaterialTheme.colorScheme.primary) }
                            if (project.optString("description").isNotBlank()) Text(project.optString("description"), Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${project.optString("status", "ready")}  ·  ${date(project.optString("updatedAt"))}", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.labelSmall)
                            OutlinedButton(onClick = { checksProjectId = project.optString("id") }, modifier = Modifier.padding(top = 12.dp)) { Text("Project checks") }
                            TextButton(onClick = { githubProjectId = project.optString("id") }, enabled = usageAllowed()) { Text("GitHub repository") }
                            TextButton(onClick = { filesProjectId = project.optString("id") }, enabled = usageAllowed()) { Text("Files and reports") }
                        }
                    }
                }
                if (state.objects("projects").isEmpty()) item { InfoCard("Space for your next idea", "Create a project here and its folder will be created inside the workspace you chose on your PC.") }
            }
        }
        if (create) AlertDialog(onDismissRequest = { create = false }, title = { Text("Start a project") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Project name") }, singleLine = true)
                OutlinedTextField(description, { description = it }, label = { Text("What are we making?") }, minLines = 2)
            }
        }, confirmButton = { TextButton(enabled = name.isNotBlank() && !busy, onClick = { launch { api("POST", "/api/projects", JSONObject().put("name", name.trim()).put("description", description.trim())); create = false; name = ""; description = ""; refresh() } }) { Text("Create project") } }, dismissButton = { TextButton(onClick = { create = false }) { Text("Cancel") } })
    }

    @Composable private fun ChatScreen() {
        val providers = state.objects("providers").filter { it.optString("id") in listOf("codex", "claude") }
        val chosen = providers.find { it.optString("id") == selectedProvider }
        val models = chosen?.optJSONArray("models")?.let { array -> (0 until array.length()).map { i -> val value = array.opt(i); if (value is JSONObject) value.optString("id", value.optString("name")) else value.toString() } } ?: emptyList()
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text(if (automatic) "Nakama chooses the AI" else "Manual override", fontWeight = FontWeight.SemiBold)
                    Text(if (selectedProject.isBlank()) "General assistant" else state.objects("projects").find { it.optString("id") == selectedProject }?.optString("name").orEmpty(), style = MaterialTheme.typography.labelSmall) }
                TextButton(onClick = { showAdvanced = !showAdvanced }) { Text(if (showAdvanced) "Hide options" else "Options") }
            }
            if (showAdvanced) {
                Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
                    ToggleRow("Automatic AI choices", "Follow your saved AI roles. Say 'plan using Claude' to override. Edit role defaults in Control Center Settings → AI roles.", automatic) { automatic = it }
                    if (!automatic) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Choice("AI", selectedProvider, providers.map { it.optString("id") }.ifEmpty { listOf("codex", "claude") }, Modifier.weight(1f)) { selectedProvider = it; selectedModel = "" }
                            Choice("Effort", effort, listOf("low", "medium", "high", "xhigh", "max", "ultra"), Modifier.weight(1f)) { effort = it }
                        }
                        if (models.isNotEmpty()) Choice("Model", selectedModel.ifBlank { chosen?.optString("selectedModel").orEmpty().ifBlank { "Provider default" } }, listOf("Provider default") + models, Modifier.fillMaxWidth()) { selectedModel = if (it == "Provider default") "" else it }
                        if (models.isEmpty() && !team) OutlinedTextField(selectedModel, { selectedModel = it }, Modifier.fillMaxWidth(), label = { Text("Model ID - blank uses account default") }, singleLine = true)
                        ToggleRow("Team mode", "Use connected providers in parallel.", team) { team = it }
                        val modeOptions = listOf("Discuss", "Do a task") + if (selectedProject.isNotBlank()) listOf("Build project files") else emptyList()
                        Choice("Mode", chatMode.takeIf { it in modeOptions } ?: "Discuss", modeOptions, Modifier.fillMaxWidth()) { chatMode = it }
                    }
                    TextButton(onClick = { selectedProject = "" }) { Text("Switch to general assistant") }
                    TextButton(onClick = { stopConversation(); tab = "Usage" }) { Text("View AI usage") }
                }
            }
            ChatHistoryControls(state, identity?.deviceId.orEmpty(), selectedProject, chatAllowed(), ::api) { refresh() }
            LocalChatHistoryControls(localChatHistory, localChatScope(), localHistoryRevision) { selected -> clearLocalTranscript(selected) }
            val workflows = (if (usageAllowed()) state.objects("projectWorkflows") else emptyList()).filter { it.optString("status") !in finishedChatWork && (selectedProject.isBlank() || it.optString("projectId") == selectedProject) }.let { rows -> focusedWorkflowId?.let { id -> rows.filter { it.optString("id") == id } } ?: rows.takeLast(3) }
            val messages = ((if (chatAllowed()) state.objects("messages").filter { DeviceDelivery.addressedTo(it, identity?.deviceId.orEmpty()) } else emptyList()).filter { it.opt("pipelineIntermediate") != true && !it.optBoolean("deliveryOnly") && (selectedProject.isBlank() || it.optString("projectId") == selectedProject) } + localMessages).sortedBy { it.optString("createdAt") }
            val activeTasks = (if (chatAllowed()) state.objects("tasks") else emptyList()).filter { it.optString("workflowId").isBlank() && it.optString("status") !in finishedChatWork && (selectedProject.isBlank() || it.optString("projectId") == selectedProject) }.takeLast(5)
            val prefixCount = (if (focusedWorkflowId != null) 1 else 0) + (if (messages.isEmpty()) 1 else 0) + (if (!chatAllowed()) 1 else 0) + workflows.size
            ChatTimeline(messages, "${identity?.deviceId}:$selectedProject:$focusedWorkflowId", chatSubmission, Modifier.weight(1f), prefixCount, activeTasks.size, focusedWorkflowId != null,
                prefix = {
                    if (focusedWorkflowId != null) item { TextButton(onClick = { focusedWorkflowId = null }) { Text("Show full project conversation") } }
                    if (messages.isEmpty()) item { InfoCard("What shall we do?", "Just type or tap Talk. Nakama follows your saved AI roles and accepts named overrides such as 'plan using Claude'. Use Video studio on your PC for Kling video requests; generation always needs your approval.") }
                    if (!chatAllowed()) item { InfoCard("AI chat needs your PC", "Connect your PC and allow Google and project access for this device. Direct phone commands can still work locally.") }
                    items(workflows, key = { "workflow-${it.optString("id")}" }) { workflow ->
                        val workflowId = workflow.optString("id")
                        ProjectWorkflowPanel(workflow, usageAllowed(), busy, onAnswers = { answers -> updateWorkflow(workflowId, "answers", answers) },
                            onStop = { updateWorkflow(workflowId, "stop", JSONObject()) }, canStop = workflow.optString("requestedBy") == identity?.deviceId,
                            dictation = questionDictation, onVoiceAnswer = { beginQuestionVoice(workflowId, it) })
                    }
                }, suffix = { items(activeTasks, key = { "task-${it.optString("id")}" }) { task -> TaskCard(task) } },
                onLookup = { lookup -> runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(lookup))) }.onFailure { notice = "No browser can open this lookup." } })
            replyWaitStartedAt?.let { started ->
                var now by remember(started) { mutableLongStateOf(SystemClock.elapsedRealtime()) }
                LaunchedEffect(started) { while (true) { now = SystemClock.elapsedRealtime(); delay(1_000) } }
                val ownedTasks = state.objects("tasks").filter { it.optString("id") in pendingReplies.ids }
                val task = ownedTasks.lastOrNull { it.optString("status") == "running" } ?: ownedTasks.lastOrNull()
                val provider = when (task?.optString("providerId")) { "codex" -> "ChatGPT"; "claude" -> "Claude"; else -> "Your AI" }
                ReplyWaitingPanel(provider, task?.optString("effort").orEmpty(), now - started, task?.optString("phase").orEmpty())
            }
            OutlinedTextField(draft, ::editDraft, Modifier.fillMaxWidth(), placeholder = { Text("Ask Nakama anything…") }, minLines = 2, maxLines = 5, shape = RoundedCornerShape(20.dp))
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { startVoice(true) }) { Text("Talk") }
                TextButton(onClick = { stopConversation() }) { Text("Stop") }
                Spacer(Modifier.weight(1f))
                Button(onClick = { sendChat() }, enabled = draft.isNotBlank() && (!busy || LocalClockCommands.parse(draft) != null || NavigationPolicy.parse(draft) != null || FoundationPolicy.command(draft) != null)) { Text("Send") }
            }
            Text(voiceState + " · Voice requests receive spoken replies; typed requests stay text only. Enable Wake word in Tools to ask while Nakama is in the background.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
        }
    }

    @Composable private fun DeviceScreen() {
        var payload by remember { mutableStateOf("") }; var deviceName by remember { mutableStateOf("${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}") }
        var packageName by remember { mutableStateOf("") }; var number by remember { mutableStateOf("") }; var message by remember { mutableStateOf("") }; var contact by remember { mutableStateOf("") }
        var actionType by remember { mutableStateOf("Call") }; var showUnpair by remember { mutableStateOf(false) }
        var eventTitle by remember { mutableStateOf("") }; var eventStart by remember { mutableStateOf("") }; var eventEnd by remember { mutableStateOf("") }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 28.dp)) {
            item { SectionTitle("Your connection", "Pair privately. Stay in control.") }
            if (identity == null) {
                item { InfoCard("Connect your Windows PC", "In Control Center, choose your PC's private Wi-Fi/LAN or VPN address, then open Devices and create a pairing ticket. Copy its pairing JSON here. Localhost points to this phone and cannot connect to your PC. Away from home, use your private VPN. Never forward port 43110 publicly.") }
                item { OutlinedTextField(deviceName, { deviceName = it }, Modifier.fillMaxWidth(), label = { Text("This device's name") }, singleLine = true) }
                item { OutlinedTextField(payload, { payload = it }, Modifier.fillMaxWidth(), label = { Text("Pairing JSON from your PC") }, minLines = 4, maxLines = 8) }
                item { Button(onClick = { pair(payload, deviceName) }, enabled = payload.isNotBlank() && !busy, modifier = Modifier.fillMaxWidth()) { Text("Pair securely") } }
            } else {
                item { InfoCard(identity?.name.orEmpty(), "${identity?.url}\nCertificate pinned · token secured by Android Keystore", "Paired device") }
                item { OutlinedButton(onClick = { showUnpair = true }) { Text("Forget this PC") } }
            }
            item { MascotPanel() }
            item { OutlinedButton(onClick = { stopConversation(); tab = "Usage" }) { Text("View AI usage") } }
            item { SectionTitle("Make it yours", "Voice, appearance and everyday permissions.") }
            item { Choice("Appearance", themeChoice, listOf("System", "Light", "Dark"), Modifier.fillMaxWidth()) { themeChoice = it; getSharedPreferences("nakama_preferences", MODE_PRIVATE).edit().putString("theme", it).apply() } }
            item { InfoCard("Replies follow your input", "Voice requests receive spoken replies using your installed offline voice. Typed requests receive text only. Stop voice ends spoken follow-up.") }
            item { ToggleRow("Reduce motion", "Keep page changes and Mote still. Android's animation setting also applies.", reduceMotion) { reduceMotion = it; preference("reduceMotion", it) } }
            item { ToggleRow("Project question and login alerts", "Generic notifications while Nakama is open or Mote is visibly running. Android/background limits apply; no always-on delivery guarantee.", projectAlertsEnabled) { enabled ->
                val saved = identity
                if (saved == null || !usageAllowed()) notice = "Pair and enable Google/project access before turning on project alerts."
                else if (!enabled) { ProjectAttention.setEnabled(this@MainActivity, saved, false); projectAlertsEnabled = false }
                else if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) projectAlertsPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                else { ProjectAttention.setEnabled(this@MainActivity, saved, true); projectAlertsEnabled = true; ProjectAttention.update(this@MainActivity, saved, state.optJSONObject("attention")) }
            } }
            item { VoiceSettingsPanel(voice, openSpeechSettings = {
                voice.stop()
                runCatching { startActivity(Intent("com.android.settings.TTS_SETTINGS")) }
                    .onFailure { notice = "Open Android Settings and search for Text-to-speech. Add English (United Kingdom) voice data, then return and refresh voices." }
            }, openInputSettings = {
                voice.stop()
                runCatching { startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)) }
                    .onFailure { notice = "Open Android Settings and search for Voice input to configure the optional Android recognition service. Bundled offline recognition does not need this setting." }
            }) }
            item { ToggleRow("Confirm ordinary phone actions", "Adds a preview for queued calls and app actions. Deployments and project deletion always need desktop approval.", confirmActions) { confirmActions = it; preference("confirmActions", it) } }
            item { OutlinedButton(onClick = { permissions.launch(arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_CONTACTS, Manifest.permission.POST_NOTIFICATIONS)) }, modifier = Modifier.fillMaxWidth()) { Text("Manage phone permissions") } }
            item { Text("Home screen widget: long-press your home screen, choose Widgets, then Nakama. The widget opens chat or starts a voice session.", style = MaterialTheme.typography.bodySmall) }
            item { SectionTitle("Phone tools", "Explicit actions on this device. Drafts still need you to send or save.") }
            item { Choice("Action", actionType, listOf("Call", "SMS draft", "WhatsApp draft", "Find contact", "Open app", "Calendar draft"), Modifier.fillMaxWidth()) { actionType = it } }
            if (actionType in listOf("Call", "SMS draft", "WhatsApp draft")) item { OutlinedTextField(number, { number = it }, Modifier.fillMaxWidth(), label = { Text("Phone number, including country code") }, singleLine = true) }
            if (actionType in listOf("SMS draft", "WhatsApp draft")) item { OutlinedTextField(message, { message = it }, Modifier.fillMaxWidth(), label = { Text("Your exact message") }, minLines = 2) }
            if (actionType == "Find contact") item { OutlinedTextField(contact, { contact = it }, Modifier.fillMaxWidth(), label = { Text("Contact name") }) }
            if (actionType == "Open app") item { InstalledAppPicker("Installed app", packageName, onSelected = { packageName = it }) }
            if (actionType == "Calendar draft") {
                item { OutlinedTextField(eventTitle, { eventTitle = it }, Modifier.fillMaxWidth(), label = { Text("Event title") }) }
                item { OutlinedTextField(eventStart, { eventStart = it }, Modifier.fillMaxWidth(), label = { Text("Start, e.g. 2026-09-30T14:00:00+01:00") }) }
                item { OutlinedTextField(eventEnd, { eventEnd = it }, Modifier.fillMaxWidth(), label = { Text("End, including timezone offset") }) }
            }
            item { Button(onClick = {
                if (actionType == "Open app" && !InstalledApps.contains(this@MainActivity, packageName)) { notice = "Choose an installed app first."; return@Button }
                val args = JSONObject()
                val type = when (actionType) {
                    "Call" -> { args.put("number", number).put("direct", true); "call" }
                    "SMS draft" -> { args.put("number", number).put("message", message); "sms" }
                    "WhatsApp draft" -> { args.put("number", number).put("message", message); "whatsapp_message" }
                    "Find contact" -> { args.put("query", contact); "contacts_search" }
                    "Calendar draft" -> { args.put("title", eventTitle).put("start", eventStart).put("end", eventEnd); "calendar" }
                    else -> { args.put("packageName", packageName); "open_app" }
                }
                notice = PhoneActions(this@MainActivity).execute(JSONObject().put("type", type).put("args", args)).message
            }, modifier = Modifier.fillMaxWidth()) { Text("${if (actionType == "Call") "Place call" else "Continue"} on this device") } }
            item { SectionTitle("Visible phone control", "Blue edges show an active session. A blue cursor marks the requested tap, typing field or scroll area.") }
            item { Text("Enable Accessibility in Android, allow notifications, then start the mascot and choose the target app below. Control lasts two minutes, with a floating STOP button. Say Android Back, show recent apps or show phone notifications during the session for explicit navigation only. Explicit screen reads share bounded visible labels with your PC; editable values and sensitive screens are excluded. Deployment and project-deletion controls require you. Screen video, unrestricted phone access and autonomous app navigation are not implemented.", style = MaterialTheme.typography.bodySmall) }
            item { InfoCard(if (NakamaAccessibilityService.activePackage.isBlank()) "Phone control is off" else "${NakamaAccessibilityService.remainingSeconds}s remaining · ${InstalledApps.label(this@MainActivity, NakamaAccessibilityService.activePackage)}", if (NakamaAccessibilityService.activePackage.isBlank()) "Accessibility ${if (NakamaAccessibilityService.connected) "connected" else "off"} · Mascot ${if (MascotOverlayService.running) "running" else "off"}. Each session needs your tap on this phone." else NakamaAccessibilityService.lastAction) }
            item { OutlinedButton(onClick = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) { Text("Open accessibility settings") } }
            item { InstalledAppPicker("Allow control of this installed app", packageName, controlOnly = true, onSelected = { packageName = it }) }
            item { Button(onClick = {
                if (!InstalledApps.contains(this@MainActivity, packageName) || !MonitorPolicy.packageAllowed(packageName)) notice = "Choose an eligible installed app first."
                else if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notice = "Enable notifications first so you always have a visible Stop control."
                else if (!Settings.canDrawOverlays(this@MainActivity)) notice = "Start the mascot first so it can receive scoped actions while another app is open."
                else if (!MascotOverlayService.running) { startMascot(); notice = "Mote is starting. Tap Enable control again once the mascot is visible." }
                else notice = runCatching { NakamaAccessibilityService.startSession(packageName.trim()).message }.getOrElse { it.message ?: "Could not start control." }
            }) { Text("Enable control for 2 minutes") } }
            item { TextButton(onClick = { NakamaAccessibilityService.stopSession(); notice = "All accessibility actions stopped." }) { Text("Stop phone control now") } }
            item { InfoCard("Your privacy", "Pairing keys stay in Android Keystore. Chat is stored on your PC. While connected with shared access, launchable app names are shared with your paired PC for its app picker. This does not enable control. Requested contacts, action outcomes and bounded app labels from explicit screen reads go to Control Center. Your phone screen is not streamed. Tools has separate opt-in controls and visible Stop notifications for local wake listening and sharing this phone's location.") }
        }
        if (showUnpair) AlertDialog(onDismissRequest = { showUnpair = false }, title = { Text("Forget this PC?") }, text = { Text("This removes the token from this device. To revoke the token on your PC too, remove this device in Control Center.") }, confirmButton = { TextButton(onClick = { vault.clear(); identity = null; clearHostContent(); connection = "Not paired"; NakamaAccessibilityService.stopSession(); stopService(Intent(this@MainActivity, MascotOverlayService::class.java)); showUnpair = false }) { Text("Forget PC") } }, dismissButton = { TextButton(onClick = { showUnpair = false }) { Text("Cancel") } })
    }

    @Composable private fun SectionTitle(title: String, subtitle: String) { Column { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(subtitle, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
    @Composable private fun InfoCard(title: String, body: String, badge: String = "") {
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(18.dp)) { if (badge.isNotBlank()) Text(badge.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(bottom = 6.dp)); Text(title, fontWeight = FontWeight.SemiBold); Text(body, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    @Composable private fun TaskCard(task: JSONObject) {
        Column { InfoCard(task.optString("title", "Agent task"), task.optString("error").ifBlank { task.optString("output").takeLast(5000).ifBlank { "Waiting for the connected agent…" } }, task.optString("status")); if (task.optString("status") in listOf("running", "queued")) TextButton(onClick = { launch { api("POST", "/api/tasks/${task.getString("id")}/stop"); refresh() } }) { Text("Stop task") } }
    }
    @Composable private fun ToggleRow(title: String, detail: String, value: Boolean, change: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f).padding(end = 12.dp)) { Text(title, fontWeight = FontWeight.Medium); Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(value, change) }
    }
    @Composable private fun Choice(label: String, value: String, options: List<String>, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
        var expanded by remember { mutableStateOf(false) }
        fun display(item: String): String = when {
            label == "AI" && item == "codex" -> "ChatGPT / Codex"
            label == "AI" && item == "claude" -> "Claude"

            label == "Effort" && item == "xhigh" -> "Ultra · xhigh"
            label == "Effort" && item == "max" -> "Ultra · max"
            else -> item
        }
        Box(modifier.padding(vertical = 3.dp)) {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) { Column(Modifier.weight(1f)) { Text(label, style = MaterialTheme.typography.labelSmall); Text(display(value), style = MaterialTheme.typography.bodySmall, maxLines = 2) }; Text("⌄") }
            DropdownMenu(expanded, { expanded = false }) { options.distinct().forEach { option -> DropdownMenuItem(text = { Text(display(option)) }, onClick = { expanded = false; onSelect(option) }) } }
        }
    }
    private fun date(value: String): String = runCatching { DateTimeFormatter.ofPattern("d MMM, HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value)) }.getOrDefault(value)
}
