package dev.nakama.companion

import android.Manifest
import android.app.AlarmManager
import android.content.pm.PackageManager
import android.speech.SpeechRecognizer
import androidx.compose.animation.core.tween
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextDecoration
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId

@Composable
fun FoundationsPanel(
    page: String, onPage: (String) -> Unit, state: JSONObject, deviceId: String?, allowed: Boolean,
    request: suspend (String, String, JSONObject?) -> JSONObject, refresh: suspend () -> Unit,
    localAction: (String) -> Unit, remoteVoice: Pair<Long, String>, remoteVoiceConsumed: () -> Unit,
    openProject: (String) -> Unit = {},
    connectionRequestId: String? = null, browserSessionId: String? = null, openBrowser: (String) -> Unit = {},
    intakeId: String? = null, intakeDictation: QuestionDictation? = null, intakeVoice: (String, String) -> Unit = { _, _ -> }, openWorkflow: (String, String) -> Unit = { _, _ -> },
    autonomousDrafts: AutonomousTaskDrafts? = null,
    monitoringDrafts: MonitoringDrafts? = null, maintenanceDrafts: SelfMaintenanceDrafts? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val motion = LocalNakamaMotion.current
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var editTask by remember { mutableStateOf<JSONObject?>(null) }
    var editRoutine by remember { mutableStateOf<JSONObject?>(null) }
    var deviceDirectory by remember { mutableStateOf(emptyList<DeviceTarget>()) }
    var directoryError by remember { mutableStateOf("") }
    LaunchedEffect(page, allowed, deviceId) {
        if (!allowed) { deviceDirectory = emptyList(); directoryError = ""; return@LaunchedEffect }
        if (page == "Routines") try {
            deviceDirectory = DeviceCommandRouting.targets(request("GET", "/api/device-targets", null)); directoryError = ""
        } catch (_: Exception) { directoryError = "Could not refresh device names. Existing selected targets are kept." }
    }
    fun mutate(method: String, path: String, body: JSONObject? = null) {
        if (!allowed || busy) return
        busy = true; error = ""
        scope.launch { try { request(method, path, body); refresh() } catch (failure: Exception) { error = failure.message.orEmpty() } finally { busy = false } }
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("Tasks", "Clock", "Monitoring", "Dynamic upgrade", "Routines", "Project setup", "Agent office", "Browser", "Account setup", "Skills", "Core Memory", "Remote PC", "Location", "Wake word").forEach { name -> FilterChip(selected = page == name, onClick = { onPage(name) }, label = { Text(name) }) }
        }
        if (!allowed && page !in listOf("Clock", "Wake word", "Location")) { Text("Connect your paired PC and enable this device's Google and project access to use shared tools."); return@Column }
        if (busy) NakamaBusy(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        MotionPage(page, Modifier.weight(1f).fillMaxWidth()) { when (page) {
            "Clock" -> ClockPanel(localAction)
            "Agent office" -> AgentOfficePanel(state.optJSONObject("agentOffice"), allowed, openProject, state.optJSONObject("browserStudio"), allowed && state.objects("devices").firstOrNull { it.optString("id") == deviceId }?.optJSONObject("permissions")?.optBoolean("browserControl") == true, request, openBrowser)
            "Browser" -> BrowserStudioPanel(deviceId, allowed && state.objects("devices").firstOrNull { it.optString("id") == deviceId }?.optJSONObject("permissions")?.optBoolean("browserControl") == true, state.objects("projects"), browserSessionId, request)
            "Account setup" -> ConnectionHandoffPanel(deviceId, allowed && state.objects("devices").firstOrNull { it.optString("id") == deviceId }?.optJSONObject("permissions")?.optBoolean("browserControl") == true, connectionRequestId, request, openBrowser)
            "Project setup" -> ProjectIntakesPanel(state, allowed, request, refresh, intakeId, intakeDictation, intakeVoice, openWorkflow)
            "Autonomous tasks" -> AutonomousTasksPanel(deviceId, allowed, state.objects("projects"), request, autonomousDrafts)
            "Monitoring" -> MonitoringPanel(deviceId, allowed, allowed && state.objects("devices").firstOrNull { it.optString("id") == deviceId }?.optJSONObject("permissions")?.optBoolean("browserControl") == true, request, openBrowser, monitoringDrafts)
            "Dynamic upgrade" -> SelfMaintenancePanel(deviceId, allowed, request, openWorkflow, maintenanceDrafts)
            "Core Memory" -> CoreMemoryPanel(deviceId, allowed, request)
            "Skills" -> SkillsPanel(deviceId, allowed, state.optJSONObject("skillLibrary"), request, refresh)
            "Tasks" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("Your task board", style = MaterialTheme.typography.titleLarge); Text("Shared tasks and project activity. Checking a card marks it complete; it does not stop the underlying agent.", style = MaterialTheme.typography.bodySmall) }
                item { Button(onClick = { onPage("Autonomous tasks") }) { Text("Autonomous tasks") } }
                item { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Button(onClick = { editTask = JSONObject() }, enabled = !busy) { Text("Add task") }; OutlinedButton(onClick = { mutate("POST", "/api/task-board/cleanup-completed", JSONObject()) }, enabled = !busy) { Text("Clear completed") } } }
                items(state.optJSONObject("taskBoard")?.objects("items").orEmpty().sortedBy { it.optBoolean("completed") }, key = { it.optString("id") }) { task ->
                    Surface(modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = tween(MotionPolicy.duration(motion, 220))), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) { Column(Modifier.padding(12.dp)) {
                        Row { Checkbox(task.optBoolean("completed"), { mutate("PATCH", "/api/task-board/items/${task.optString("id")}", JSONObject().put("completed", it)) }, enabled = !busy); Column(Modifier.weight(1f)) { Text(task.optString("title"), style = MaterialTheme.typography.titleSmall, textDecoration = if (task.optBoolean("completed")) TextDecoration.LineThrough else null); Text(task.optString("details"), style = MaterialTheme.typography.bodySmall); Text(task.optString("sourceKind") + " · " + task.optString("sourceStatus"), style = MaterialTheme.typography.labelSmall) } }
                        Row { TextButton(onClick = { editTask = task }, enabled = !busy) { Text("Edit") }; TextButton(onClick = { mutate("DELETE", "/api/task-board/items/${task.optString("id")}") }, enabled = !busy) { Text("Remove card") } }
                    } }
                }
                if (state.optJSONObject("taskBoard")?.objects("items").isNullOrEmpty()) item { Text("No cards yet. Say 'add a task to…' or add one here.") }
            }
            "Routines" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("Routines and alarms", style = MaterialTheme.typography.titleLarge); Text("Reminders are recorded on your PC. Phone alarms need Alarms & reminders permission and Sync phone alarms. Changes made while the phone is offline take effect after its next sync.", style = MaterialTheme.typography.bodySmall) }
                item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { Button(onClick = { editRoutine = JSONObject() }, enabled = !busy) { Text("Add routine") }; OutlinedButton(onClick = { localAction("sync_alarms") }) { Text("Sync phone alarms") }; OutlinedButton(onClick = { localAction("alarm_permission") }) { Text("Alarm permission") }; OutlinedButton(onClick = { localAction("silence_alarms") }) { Text("Silence ringing alarms") } } }
                item { Text(if (context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) "Exact alarm permission available. Notification volume and Do Not Disturb still apply." else "Exact alarms need your Android permission.", style = MaterialTheme.typography.bodySmall) }
                items(state.optJSONObject("routineBoard")?.objects("occurrences").orEmpty().filter { it.optString("status") == "pending" && DeviceDelivery.addressedTo(it, deviceId.orEmpty()) }, key = { "occurrence-${it.optString("id")}" }) { occurrence ->
                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) { Column(Modifier.padding(12.dp)) { Text("Due: ${occurrence.optString("title")}"); Text(occurrence.optString("scheduledFor"), style = MaterialTheme.typography.bodySmall); TextButton(onClick = { mutate("POST", "/api/routines/occurrences/${occurrence.optString("id")}/ack", JSONObject()) }) { Text("Acknowledge") } } }
                }
                items(state.optJSONObject("routineBoard")?.objects("routines").orEmpty(), key = { it.optString("id") }) { routine ->
                    Surface(modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = tween(MotionPolicy.duration(motion, 220))), color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) { Column(Modifier.padding(12.dp)) {
                        Row { Column(Modifier.weight(1f)) { Text(routine.optString("title"), style = MaterialTheme.typography.titleSmall); Text("${routine.optString("kind")} · ${routine.optString("time")} · ${routine.optString("timeZone")}", style = MaterialTheme.typography.bodySmall) }; Switch(routine.optBoolean("enabled"), { mutate("PATCH", "/api/routines/${routine.optString("id")}", JSONObject().put("enabled", it)) }, enabled = !busy) }
                        if (routine.optString("details").isNotBlank()) Text(routine.optString("details"))
                        if (routine.optString("kind") == "alarm") {
                            DeviceDelivery.alarmTargets(routine).forEach { targetId ->
                                val name = deviceDirectory.firstOrNull { it.id == targetId }?.name ?: if (targetId == deviceId) "This device" else "Unavailable target: $targetId"
                                val receipt = DeviceDelivery.alarmReceipt(routine, targetId)
                                Text("$name: " + if (receipt == null) "Pending · sync alarms on this device." else receipt.optString("status") + " · " + receipt.optString("detail"), style = MaterialTheme.typography.bodySmall)
                            }
                            if (deviceId !in DeviceDelivery.alarmTargets(routine)) Text("This device is not an alarm target. It will not ring here.", style = MaterialTheme.typography.bodySmall)
                        }
                        Row { TextButton(onClick = { editRoutine = routine }, enabled = !busy) { Text("Edit") }; TextButton(onClick = { mutate("DELETE", "/api/routines/${routine.optString("id")}") }, enabled = !busy) { Text("Delete routine") } }
                    } }
                }
            }
            "Remote PC" -> RemoteDesktopPanel(request, remoteVoice, remoteVoiceConsumed)
            "Location" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { Text("This phone's location", style = MaterialTheme.typography.titleLarge); Text("Explicit sharing with your paired PC. Uses Android location providers without Google Play Services. Only the latest fix is kept; Stop ends this phone's updates. Forget removes the PC's saved fix.", style = MaterialTheme.typography.bodySmall) }
                item { Text("On this phone: ${DeviceLocationService.status}") }
                val own = state.objects("deviceLocations").firstOrNull { it.optString("deviceId") == deviceId }
                val fix = if (allowed) own?.optJSONObject("lastKnown") else null
                if (fix != null) item { Text("Last known: ${fix.optDouble("latitude")}, ${fix.optDouble("longitude")}\nObserved: ${fix.optString("observedAt")}\nAccuracy: ${fix.optDouble("accuracy").toInt()} m\nReceived by PC: ${fix.optString("receivedAt")}", style = MaterialTheme.typography.bodyMedium) }
                else item { Text(if (allowed) "No shared fix yet. A timestamped last-known fix is not a guarantee of the phone's present position." else "Pair and enable Google/project access before sharing or viewing location.") }
                item { Button(onClick = { localAction("start_location") }, enabled = allowed && !DeviceLocationService.running) { Text("Start sharing this phone") } }
                item { OutlinedButton(onClick = { localAction("update_location") }, enabled = DeviceLocationService.running) { Text("Refresh location") } }
                item { OutlinedButton(onClick = { localAction("stop_location") }) { Text("Stop location sharing") } }
                item { TextButton(onClick = { localAction("forget_location") }, enabled = allowed) { Text("Forget saved location") } }
                item { TextButton(onClick = { localAction("location_permissions") }) { Text("Location permissions") } }
                item { TextButton(onClick = { localAction("background_location") }) { Text("Background location settings") }; Text("Start sharing while Nakama is open. Android can keep its visible location service running after you leave. 'Allow all the time' is a separate optional Android grant; no invisible or automatic boot tracking starts.", style = MaterialTheme.typography.bodySmall) }
            }
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { Text("Say Nakama", style = MaterialTheme.typography.titleLarge); Text("${WakeWordService.status}") }
                item { Text("Enable once, then say 'Nakama' or 'Hey Nakama' followed by your request. When Android finishes recognising your sentence it is submitted automatically and answered aloud, including while this app is in the background. Wake audio stays on Android's on-device recognizer; greetings, time, date and timer commands stay on this device, while other completed requests go to your paired PC under its saved model roles and permissions. A persistent notification has Stop. Listening pauses during speech and while the phone is locked.", style = MaterialTheme.typography.bodySmall) }
                item { Text(if (SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) "Android reports an on-device service. This does not prove an offline English model is installed or that continuous input is supported." else "Unavailable: Android reports no on-device recognizer. Select a compatible service in Android Voice input settings. Typing and Talk remain available.") }
                item { Text(LocalSpeechStatus.detail, style = MaterialTheme.typography.bodyMedium) }
                item { Text("Wait for 'Microphone ready' before speaking. 'Starting' is not a listening confirmation. 'Wake phrase heard' means the phrase was recognised provisionally; only a completed result sends your request.", style = MaterialTheme.typography.bodySmall) }
                item { Button(onClick = { localAction("start_wake") }, enabled = !WakeWordService.running) { Text("Enable Nakama wake word") } }
                item { OutlinedButton(onClick = { localAction("restart_wake") }) { Text("Restart wake listening") } }
                item { OutlinedButton(onClick = { localAction("stop_wake") }, enabled = WakeWordService.running) { Text("Stop wake listening") } }
                item { OutlinedButton(onClick = { localAction("wake_input_settings") }) { Text("Android Voice input settings") } }
                item { OutlinedButton(onClick = { localAction("download_wake_model") }) { Text("Download local English model") }; Text("This explicit download uses the internet for model data; it does not upload audio. If your service cannot download here, add offline English in Android Voice input settings, then restart. Speech recognition models and Text-to-speech voices are separate downloads.", style = MaterialTheme.typography.bodySmall) }
                item { Text("Leave the listening notification enabled for background questions. Phone control and protected permissions can still need you to open Nakama; Mote attempts the foreground handoff when available. Wake mode asks for one continuous local audio session to avoid the old repeated listening chimes. If your recognizer ends that session, wake mode pauses and tells you to use Talk or another on-device service. Nakama never mutes device or other app sounds. Providers may still play a sound when a session starts. Continuous microphone use consumes battery. Android may stop it; force-stop and restart need you to reopen Nakama. Your opt-in is remembered, and Stop disables it. Installation alone cannot enable an always-on microphone.", style = MaterialTheme.typography.bodySmall) }
                item { Text("Try: 'Nakama, show my tasks', 'open routines', 'connect remote desktop', 'switch monitor 2', 'start location sharing', or any ordinary task. Protected permissions still need your Android/PC controls.", style = MaterialTheme.typography.bodySmall) }
            }
        } }
    }
    LaunchedEffect(allowed) { if (!allowed) { editTask = null; editRoutine = null } }
    editTask?.let { task ->
        var title by remember(task) { mutableStateOf(task.optString("title")) }; var details by remember(task) { mutableStateOf(task.optString("details")) }
        AlertDialog(onDismissRequest = { editTask = null }, title = { Text("Task card") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(title, { title = it.take(160) }, label = { Text("Title") }); OutlinedTextField(details, { details = it.take(3000) }, label = { Text("Details") }, minLines = 3) } }, confirmButton = { TextButton(enabled = title.isNotBlank() && !busy, onClick = { val id = task.optString("id"); mutate(if (id.isBlank()) "POST" else "PATCH", "/api/task-board/items" + if (id.isBlank()) "" else "/$id", JSONObject().put("title", title.trim()).put("details", details)); editTask = null }) { Text("Save task") } }, dismissButton = { TextButton(onClick = { editTask = null }) { Text("Cancel") } })
    }
    editRoutine?.let { routine ->
        var title by remember(routine) { mutableStateOf(routine.optString("title")) }; var details by remember(routine) { mutableStateOf(routine.optString("details")) }
        var time by remember(routine) { mutableStateOf(routine.optString("time").ifBlank { "09:00" }) }; var kind by remember(routine) { mutableStateOf(routine.optString("kind").ifBlank { "reminder" }) }
        var targetIds by remember(routine) { mutableStateOf(DeviceDelivery.alarmTargets(routine).ifEmpty { if (routine.optString("id").isBlank() || routine.optString("kind") != "alarm") setOfNotNull(deviceId) else emptySet() }) }
        val deviceTargets = deviceDirectory.filter { it.platform == "android" }
        val weekdayArray = routine.optJSONArray("weekdays")
        var days by remember(routine) { mutableStateOf(if (weekdayArray == null) (0..6).toSet() else (0 until weekdayArray.length()).map { weekdayArray.optInt(it) }.toSet()) }
        AlertDialog(onDismissRequest = { editRoutine = null }, title = { Text("Routine") }, text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(title, { title = it.take(160) }, label = { Text("Title") }); OutlinedTextField(details, { details = it.take(3000) }, label = { Text("Details") }, maxLines = 2)
            OutlinedTextField(time, { time = it.take(5) }, label = { Text("Time · HH:mm") }, singleLine = true)
            Text(routine.optString("timeZone").ifBlank { ZoneId.systemDefault().id }, style = MaterialTheme.typography.bodySmall)
            Row { listOf("reminder", "alarm").forEach { item -> FilterChip(selected = kind == item, onClick = { kind = item; if (item == "alarm") targetIds = targetIds.filterNot { id -> id == "desktop" || deviceDirectory.any { it.id == id && it.platform != "android" } }.toSet() }, label = { Text(item) }) } }
            Row(Modifier.horizontalScroll(rememberScrollState())) { listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").forEachIndexed { index, day -> FilterChip(selected = index in days, onClick = { days = if (index in days) days - index else days + index }, label = { Text(day) }) } }
            if (kind == "alarm") {
                Text("Ring on selected devices", style = MaterialTheme.typography.labelLarge)
                Text("New alarms select only this device. Select more devices explicitly, then sync alarms on each target. Offline devices update after their next sync.", style = MaterialTheme.typography.bodySmall)
                val choices = (deviceTargets + targetIds.filter { id -> deviceTargets.none { it.id == id } && id != "desktop" && deviceDirectory.none { it.id == id && it.platform != "android" } }.map { id -> DeviceTarget(id, if (id == deviceId) "This device" else "Unavailable target: $id", "unknown", false) }).distinctBy { it.id }
                Column {
                    choices.forEach { target -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Checkbox(target.id in targetIds, { checked -> targetIds = if (checked && targetIds.size < 10) targetIds + target.id else targetIds - target.id }, enabled = target.id in targetIds || targetIds.size < 10)
                        Text(target.name + if (target.id == deviceId && target.name != "This device") " (this device)" else if (!target.connected && target.id != deviceId) " (offline)" else "")
                    } }
                }
                targetIds.filter { id -> id == "desktop" || deviceDirectory.any { it.id == id && it.platform != "android" } }.forEach { id ->
                    Text("Unsupported alarm target: $id", color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { targetIds = targetIds - id }) { Text("Remove unsupported target") }
                }
                Text("Choose up to 10 devices.", style = MaterialTheme.typography.bodySmall)
                if (directoryError.isNotBlank()) Text(directoryError, color = MaterialTheme.colorScheme.error)
                if (targetIds.isEmpty()) Text("Choose at least one device.", color = MaterialTheme.colorScheme.error)
            }
        } }, confirmButton = { TextButton(enabled = title.isNotBlank() && days.isNotEmpty() && (kind != "alarm" || targetIds.size in 1..10) && time.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) && !busy, onClick = {
            val id = routine.optString("id")
            mutate(if (id.isBlank()) "POST" else "PATCH", "/api/routines" + if (id.isBlank()) "" else "/$id", JSONObject().put("title", title.trim()).put("details", details).put("kind", kind).put("time", time).put("timeZone", routine.optString("timeZone").ifBlank { ZoneId.systemDefault().id }).put("weekdays", JSONArray(days.sorted())).put("enabled", routine.optBoolean("enabled", true)).put("targetDeviceIds", JSONArray(targetIds.sorted()))); editRoutine = null
        }) { Text("Save routine") } }, dismissButton = { TextButton(onClick = { editRoutine = null }) { Text("Cancel") } })
    }
}
