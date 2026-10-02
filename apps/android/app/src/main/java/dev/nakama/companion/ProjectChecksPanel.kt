package dev.nakama.companion

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class CheckRequestReceipt(val name: String, val approvalId: String?, val uncertain: Boolean = false)
private data class CheckReceiptScope(val identity: HostIdentity?, val projectId: String, val projectAllowed: Boolean, val historyAllowed: Boolean)

@Composable
fun ProjectChecksPanel(
    identity: HostIdentity?,
    state: JSONObject,
    connected: Boolean,
    initialProjectId: String,
    request: suspend (HostIdentity, String, String, JSONObject?) -> JSONObject,
    refreshState: suspend (HostIdentity) -> Unit,
    onBack: () -> Unit,
) {
    val coroutines = rememberCoroutineScope()
    var selectedId by remember(identity, initialProjectId) { mutableStateOf(initialProjectId) }
    val access = ProjectChecksModels.access(state, identity?.deviceId)
    val projects = if (connected && access.projectAllowed) state.objects("projects") else emptyList()
    val project = projects.find { it.optString("id") == selectedId }
    val currentScope = ProjectCheckScope(identity, selectedId, access.projectAllowed && project != null, access.historyAllowed, connected)
    val gate = remember { ProjectChecksRequestGate() }
    gate.update(currentScope)
    DisposableEffect(gate) { onDispose { gate.invalidate() } }
    var catalogue by remember(currentScope) { mutableStateOf<ProjectCheckCatalogue?>(null) }
    var busy by remember(currentScope) { mutableStateOf("") }
    var feedback by remember(currentScope) { mutableStateOf("") }
    // Keep only a minimal submission reminder through transient disconnects.
    // Pairing, project or privacy changes still discard it; logs never live here.
    val receiptScope = CheckReceiptScope(identity, selectedId, access.projectAllowed && state.objects("projects").any { it.optString("id") == selectedId }, access.historyAllowed)
    var receipt by remember(receiptScope) { mutableStateOf<CheckRequestReceipt?>(null) }
    var expanded by remember(currentScope) { mutableStateOf(false) }
    var clearReminder by remember(currentScope) { mutableStateOf(false) }
    val tasks = remember(state, currentScope) {
        ProjectChecksModels.tasks(state, selectedId, connected && currentScope.projectAllowed && access.historyAllowed)
    }
    val approval = if (connected && access.historyAllowed) receipt?.approvalId?.let { approvalId ->
        state.objects("approvals").firstOrNull {
            it.optString("id") == approvalId && it.optString("type") == "project_check" && it.optString("requestedBy") == identity?.deviceId
        }?.let(ProjectChecksModels::approval)
    } else null
    val pending = receipt != null && (approval == null || approval.status in listOf("pending", "executing", "unknown"))
    val running = tasks.any { it.status in listOf("running", "queued") } || catalogue?.active == true

    fun path(id: String) = "/api/projects/${Uri.encode(id)}/checks"
    fun errorText(error: Exception, write: Boolean): String {
        val detail = error.message.orEmpty().take(1600)
        val message = when ((error as? HostException)?.status) {
            401 -> "This pairing is no longer accepted. Pair again from the Device tab."
            403 -> "Project access is unavailable. On your PC, open Devices and check this phone's project permission."
            404 -> "This project is no longer available. Refresh the project list and choose another project."
            409 -> "The project or its checks changed, or a run is still active. Refresh checks and review the current scripts before requesting again."
            else -> "Could not complete this request. Check that your PC is on and your private connection is working."
        }
        return message + (if (detail.isNotBlank()) "\n$detail" else "") +
            (if (write) "\nIf the connection broke after submission, check Activity & approvals on your PC before trying again. Nakama does not retry automatically." else "")
    }
    fun loadChecks() {
        val ticket = gate.begin() ?: return
        busy = "load"; feedback = ""; catalogue = null
        coroutines.launch {
            try {
                val result = request(requireNotNull(ticket.scope.identity), "GET", path(ticket.scope.projectId), null)
                if (gate.accepts(ticket)) catalogue = ProjectChecksModels.catalogue(result)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (gate.accepts(ticket)) feedback = errorText(error, false) }
            finally { if (gate.finish(ticket)) busy = "" }
        }
    }
    fun requestCheck(name: String) {
        val current = catalogue ?: return
        if (pending || running) return
        val body = try { ProjectChecksModels.requestBody(current, name) }
            catch (error: IllegalArgumentException) { feedback = error.message.orEmpty(); return }
        val ticket = gate.begin() ?: return
        busy = "request"; feedback = ""
        receipt = CheckRequestReceipt(name, null, true)
        coroutines.launch {
            try {
                val result = request(requireNotNull(ticket.scope.identity), "POST", path(ticket.scope.projectId) + "/request", body)
                if (gate.accepts(ticket)) {
                    val accepted = ProjectChecksModels.approval(result)
                    receipt = CheckRequestReceipt(name, accepted?.id, accepted == null)
                    feedback = if (accepted?.status == "pending")
                        "Request sent for desktop approval. This is not a completed check. Open Activity & approvals in Control Center to review the exact scripts."
                    else "Your PC received the request. Check Activity & approvals for its status before requesting again."
                    catalogue = null
                }
                // Refresh only public state. This does not approve or execute a check.
                if (gate.accepts(ticket)) refreshState(requireNotNull(ticket.scope.identity))
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (gate.accepts(ticket)) {
                    val knownRejection = error is HostException && error.status in 400..499
                    if (knownRejection && receipt?.approvalId == null) receipt = null
                    feedback = errorText(error, !knownRejection)
                    catalogue = null
                }
            } finally { if (gate.finish(ticket)) busy = "" }
        }
    }
    fun refreshResults() {
        val ticket = gate.begin() ?: return
        busy = "results"; feedback = ""
        coroutines.launch {
            try { refreshState(requireNotNull(ticket.scope.identity)) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (gate.accepts(ticket)) feedback = errorText(error, false) }
            finally { if (gate.finish(ticket)) busy = "" }
        }
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            TextButton(onClick = onBack) { Text("‹ All projects") }
            Text("Project checks", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Review existing npm scripts and request a run on your PC.", style = MaterialTheme.typography.bodyMedium)
        }
        when {
            identity == null -> item { CheckInfo("Connect your PC first", "Pair from the Device tab to use project checks.") }
            !connected -> item { CheckInfo("Reconnect to Control Center", "Keep your PC on and connected to your private network, then use Refresh at the top. Check previews and results stay hidden until the connection returns.") }
            !access.projectAllowed -> item { CheckInfo("Project access is unavailable", "On your PC, open Devices and enable project access for this phone. Then refresh Nakama.") }
            else -> {
                item {
                    Box {
                        OutlinedButton(onClick = { expanded = true }, enabled = busy != "request", modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f)) {
                                Text("Project", style = MaterialTheme.typography.labelSmall)
                                Text(project?.optString("name") ?: "Choose a project")
                            }
                            Text("⌄")
                        }
                        DropdownMenu(expanded, { expanded = false }) {
                            projects.forEach { option ->
                                DropdownMenuItem(text = { Text(option.optString("name")) }, onClick = {
                                    val next = option.optString("id")
                                    if (next != selectedId) { gate.invalidate(); selectedId = next }
                                    expanded = false
                                })
                            }
                        }
                    }
                }
                if (project == null) item { CheckInfo("Choose an available project", "This selection may have been removed. Refresh the project list, then choose a project above.") }
                else {
                    item { Text("Before requesting a run, check pending approvals on your PC. Leaving this screen does not cancel a request. Its local reminder is not recovered when you return.", style = MaterialTheme.typography.bodySmall) }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = ::loadChecks, enabled = busy.isBlank()) { Text("Refresh checks") }
                            OutlinedButton(onClick = ::refreshResults, enabled = busy.isBlank()) { Text("Refresh results") }
                        }
                    }
                    if (busy.isNotBlank()) item { NakamaBusy(Modifier.fillMaxWidth()) }
                    if (feedback.isNotBlank()) item { CheckInfo("Update", feedback) }
                    if (receipt != null) item {
                        val title = when {
                            busy == "request" -> "Sending check request"
                            receipt?.uncertain == true -> "Check your PC before trying again"
                            !access.historyAllowed -> "Request submitted to your PC"
                            approval?.status == "pending" -> "Awaiting desktop approval"
                            approval?.status == "started" -> "Check started on your PC"
                            approval?.status == "rejected" -> "Request declined"
                            approval?.status in listOf("failed", "expired", "interrupted") -> "Request ${approval?.status}"
                            else -> "Request sent"
                        }
                        CheckInfo(title, when {
                            busy == "request" -> "Waiting for Control Center to confirm receipt. Do not submit another request."
                            !access.historyAllowed -> "This device cannot view approval or task history. Check Activity & approvals and project activity on your PC."
                            receipt?.uncertain == true -> "The reply was interrupted or incomplete. Your PC may already have an approval waiting. No request is retried automatically."
                            approval?.status == "pending" -> "Review the exact before, main and after scripts in Control Center. Only the desktop can approve them. Requests expire after ten minutes; your PC checks the current status."
                            approval?.status == "started" -> "Approval started a task; it is not a successful check result. See the task below for its final status and exit code."
                            approval?.error?.isNotBlank() == true -> approval.error
                            approval?.status == "rejected" -> "The desktop declined this request. Refresh checks before choosing a new run."
                            else -> "Refresh results for the latest permitted status, or check Control Center."
                        })
                        if (pending && busy.isBlank()) TextButton(onClick = { clearReminder = true }) { Text("I checked on my PC") }
                    }
                    if (catalogue == null && busy != "load") item { CheckInfo("Load this project's scripts", "Tap Refresh checks to inspect the current package.json. No scripts run during discovery.") }
                    catalogue?.let { current ->
                        if (!current.runtimeAvailable) item { CheckInfo("Node.js or npm is unavailable", current.runtimeDetail.ifBlank { "Install Node.js and npm on your PC, restart Control Center, then refresh checks." }) }
                        if (!current.supported) item { CheckInfo(if (current.manifestHash != null) "No supported scripts yet" else "Checks are unavailable", current.detail.ifBlank { "Add test, lint, typecheck, check or build to this project's root package.json on your PC, then refresh." }) }
                        if (current.supported && current.detail.isNotBlank()) item { Text(current.detail, style = MaterialTheme.typography.bodySmall) }
                        if (running) item { CheckInfo("A check is already running", "Wait for the current run to finish, then refresh checks before requesting another.") }
                        items(current.checks, key = { "script-${it.name}" }) { check ->
                            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
                                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text("npm run ${check.name}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                    check.preScript?.let { CheckScript("Before · pre${check.name}", it) }
                                    CheckScript("Main · ${check.name}", check.script)
                                    check.postScript?.let { CheckScript("After · post${check.name}", it) }
                                    if (check.truncated) Text("Long previews are shortened here. Review the full scripts in desktop approval.", style = MaterialTheme.typography.bodySmall)
                                    Button(onClick = { requestCheck(check.name) }, enabled = busy.isBlank() && !pending && !running && current.runtimeAvailable && current.supported && current.manifestHash != null) { Text("Request ${check.name} approval") }
                                }
                            }
                        }
                        if (current.supported && current.manifestHash == null) item { CheckInfo("Refresh required", "The host did not provide a valid package.json fingerprint. Refresh checks before requesting a run.") }
                    }
                    item { CheckInfo("You approve each run on your PC", "Scripts run with your Windows account's permissions and may change files or use the network. A changed package.json needs a new approval. Dependencies are not installed automatically. This screen cannot approve, run or repeat a check by itself.") }
                    item { Text("Check results", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                    if (!access.historyAllowed) item { CheckInfo("History is hidden for this device", "When this device's Google access is disabled, Control Center also hides shared task and approval history to protect private content. You can still request checks. Read their results on your PC.") }
                    else {
                        item { Text("Latest 20 check tasks for this project. Output is a bounded excerpt; stored logs may already omit earlier lines. No success is assumed from approval alone.", style = MaterialTheme.typography.bodySmall) }
                        if (tasks.isEmpty()) item { CheckInfo("No visible check results yet", "After desktop approval, refresh results to see the task status, exit code and recorded output.") }
                        items(tasks, key = { "task-${it.id}" }) { CheckTaskCard(it) }
                    }
                }
            }
        }
    }
    if (clearReminder) AlertDialog(
        onDismissRequest = { clearReminder = false },
        title = { Text("Clear this local reminder?") },
        text = { Text("First check Activity & approvals and project activity on your PC. Clearing this reminder does not cancel an approval or stop a task. Refresh checks before making another request.") },
        confirmButton = { TextButton(onClick = { receipt = null; catalogue = null; feedback = ""; clearReminder = false }) { Text("Clear reminder") } },
        dismissButton = { TextButton(onClick = { clearReminder = false }) { Text("Keep reminder") } },
    )
}

@Composable private fun CheckInfo(title: String, text: String) {
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable private fun CheckScript(label: String, script: String) {
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    SelectionContainer {
        Text(script, Modifier.fillMaxWidth().heightIn(max = 180.dp).verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun CheckTaskCard(task: ProjectCheckTask) {
    var showOutput by remember(task.id) { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(task.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(task.status.replaceFirstChar { it.uppercase() }, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            if (task.updatedAt.isNotBlank()) Text(task.updatedAt, style = MaterialTheme.typography.labelSmall)
            if (task.exitCode != null) Text("Exit code: ${task.exitCode}", fontWeight = FontWeight.SemiBold)
            else Text(if (task.status in listOf("running", "queued")) "Waiting for a final exit result." else "No exit code was recorded.", style = MaterialTheme.typography.bodySmall)
            task.signal?.let { Text("Stopped by signal: $it", style = MaterialTheme.typography.bodySmall) }
            if (task.error.isNotBlank()) Text(task.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            if (task.output.isBlank()) Text("No readable output was recorded.", style = MaterialTheme.typography.bodySmall)
            else {
                TextButton(onClick = { showOutput = !showOutput }) { Text(if (showOutput) "Hide output" else "Show output") }
                if (showOutput) {
                    if (task.outputTruncated) Text("Showing the latest output excerpt. Earlier lines were omitted.", style = MaterialTheme.typography.labelSmall)
                    SelectionContainer {
                        Text(task.output, Modifier.fillMaxWidth().heightIn(max = 300.dp).verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
