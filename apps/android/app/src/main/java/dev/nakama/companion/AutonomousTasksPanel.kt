package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// Session-only drafts survive switching tools without persisting private answers to disk.
class AutonomousTaskDrafts {
    var identityKey: String? = null
    var goal by mutableStateOf("")
    var projectId by mutableStateOf("")
    var focusedRunId by mutableStateOf<String?>(null)
    val answers = mutableStateMapOf<String, String>()
    val revisions = mutableStateMapOf<String, Int>()
    fun clear() { goal = ""; projectId = ""; focusedRunId = null; answers.clear(); revisions.clear() }
}

@Composable
fun AutonomousTasksPanel(identityKey: String?, allowed: Boolean, projects: List<JSONObject>, request: suspend (String, String, JSONObject?) -> JSONObject, savedDrafts: AutonomousTaskDrafts? = null) {
    val drafts = savedDrafts ?: remember { AutonomousTaskDrafts() }
    val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentIdentity by rememberUpdatedState(identityKey)
    val currentRequest by rememberUpdatedState(request)
    var runs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var capabilityDetail by remember { mutableStateOf("") }
    var tools by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var loadError by remember { mutableStateOf("") }
    var generation by remember { mutableLongStateOf(0) }
    var reads by remember { mutableLongStateOf(0) }
    suspend fun load(expected: String?, token: Long) {
        val read = ++reads
        val result = currentRequest("GET", "/api/autonomous-tasks", null)
        if (currentAllowed && currentIdentity == expected && generation == token && reads == read) {
            runs = result.objects("runs")
            val capabilities = result.optJSONObject("capabilities")
            capabilityDetail = capabilities?.optString("limits").orEmpty().ifBlank { capabilities?.optString("detail").orEmpty().ifBlank { result.optString("detail") } }
            tools = capabilities?.objects("tools").orEmpty()
            loaded = true; loadError = ""
        }
    }
    LaunchedEffect(identityKey, allowed) {
        val token = ++generation
        runs = emptyList(); loaded = false; error = ""; loadError = ""; capabilityDetail = ""; tools = emptyList()
        if (!allowed || drafts.identityKey != identityKey) drafts.clear()
        drafts.identityKey = identityKey
        if (!allowed || identityKey == null) { busy = false; return@LaunchedEffect }
        while (true) {
            if (!busy) try { load(identityKey, token) } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == identityKey && token == generation) loadError = failure.message.orEmpty() }
            delay(6000)
        }
    }
    fun send(route: String, body: JSONObject, onSaved: () -> Unit = {}) {
        if (!allowed || identityKey == null || busy) return
        val expected = identityKey; val token = generation
        busy = true; reads++; error = ""
        scope.launch {
            try {
                currentRequest("POST", route, body)
                if (currentAllowed && currentIdentity == expected && generation == token) { onSaved(); load(expected, token) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == expected && generation == token) error = failure.message.orEmpty() }
            finally { if (generation == token) busy = false }
        }
    }
    if (!allowed || identityKey == null) { Text("Connect your paired PC and enable Google and project access to use autonomous tasks."); return }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Text("Autonomous tasks", style = MaterialTheme.typography.headlineSmall)
            Text("Give Nakama a goal. It saves progress, asks questions and records actions. Protected actions still need exact PC approval. Private browser content stays private.", style = MaterialTheme.typography.bodySmall)
            if (capabilityDetail.isNotBlank()) Text(capabilityDetail, style = MaterialTheme.typography.bodySmall)
            var showTools by remember { mutableStateOf(false) }
            if (tools.isNotEmpty()) TextButton(onClick = { showTools = !showTools }) { Text(if (showTools) "Hide available task tools" else "Available task tools") }
            if (showTools) tools.forEach { tool -> Text(tool.optString("name").replace('_', ' ') + tool.optString("detail").let { if (it.isBlank()) "" else ": $it" }, style = MaterialTheme.typography.bodySmall) }
            if (drafts.focusedRunId != null) TextButton(onClick = { drafts.focusedRunId = null }) { Text("Show all autonomous tasks") }
        }
        item {
            OutlinedTextField(drafts.goal, { drafts.goal = it.take(12000) }, Modifier.fillMaxWidth(), label = { Text("Task goal") }, enabled = !busy, minLines = 3)
            var chooseProject by remember { mutableStateOf(false) }
            TextButton(enabled = !busy, onClick = { chooseProject = !chooseProject }) { Text("Project context: " + projects.firstOrNull { it.optString("id") == drafts.projectId }?.optString("name").orEmpty().ifBlank { "No project" }) }
            if (chooseProject) {
                TextButton(enabled = !busy, onClick = { drafts.projectId = ""; chooseProject = false }) { Text("No project") }
                projects.forEach { project -> TextButton(enabled = !busy, onClick = { drafts.projectId = project.optString("id"); chooseProject = false }) { Text(project.optString("name")) } }
            }
            Button(enabled = !busy && loaded && drafts.goal.isNotBlank() && (drafts.projectId.isBlank() || projects.any { it.optString("id") == drafts.projectId }), onClick = { send("/api/autonomous-tasks", JSONObject().put("goal", drafts.goal.trim()).apply { if (drafts.projectId.isNotBlank()) put("projectId", drafts.projectId) }) { drafts.goal = "" } }) { Text("Start autonomous task") }
        }
        if (busy || !loaded && error.isBlank() && loadError.isBlank()) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (loadError.isNotBlank()) item { Text(loadError, color = MaterialTheme.colorScheme.error) }
        if (loaded && runs.isEmpty()) item { Text("No autonomous tasks yet.") }
        if (loaded && drafts.focusedRunId != null && runs.none { it.optString("id") == drafts.focusedRunId }) item { Text("This task is resolved or outside your current access.") }
        items(runs.filter { drafts.focusedRunId == null || it.optString("id") == drafts.focusedRunId }.reversed(), key = { it.optString("id") }) { run ->
            val id = run.optString("id"); val status = run.optString("status"); val revision = run.optInt("revision")
            val canControl = run.optString("requestedBy") == identityKey
            val pending = run.objects("questions").filter { it.optString("answer").isBlank() }
            val draftRevision = drafts.revisions[id] ?: revision
            val stale = draftRevision != revision && drafts.answers.any { it.key.startsWith("$id:") && it.value.isNotBlank() }
            var showReceipts by remember(id) { mutableStateOf(false) }
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(run.optString("goal"), style = MaterialTheme.typography.titleMedium)
                    MotionStatus(status)
                    Text("Step ${run.optInt("step")}" + if (status in listOf("running", "awaiting_answers", "awaiting_approval", "awaiting_result")) " · ${run.optString("stage").replace('_', ' ')}" else "", style = MaterialTheme.typography.labelSmall)
                    if (run.optString("summary").isNotBlank()) Text(run.optString("summary"))
                    if (run.optString("detail").isNotBlank()) Text(run.optString("detail"), style = MaterialTheme.typography.bodySmall)
                    if (run.optString("error").isNotBlank()) Text(run.optString("error"), color = MaterialTheme.colorScheme.error)
                    if (status == "awaiting_answers") {
                        var discardAnswers by remember(id) { mutableStateOf(false) }
                        Text("Your manager needs these answers before continuing. Answers do not approve protected actions.", style = MaterialTheme.typography.bodySmall)
                        if (!canControl) Text("Answer on the PC or the device that started this task.", style = MaterialTheme.typography.bodySmall)
                        pending.forEach { question ->
                            val key = "$id:${question.optString("id")}";
                            if (canControl) OutlinedTextField(drafts.answers[key].orEmpty(), { if (!drafts.revisions.containsKey(id)) drafts.revisions[id] = revision; drafts.answers[key] = it.take(6000) }, Modifier.fillMaxWidth(), label = { Text(question.optString("question")) }, enabled = !busy, minLines = 2)
                            else Text(question.optString("question"), style = MaterialTheme.typography.bodySmall)
                        }
                        if (stale) Text("This task changed elsewhere. Copy your draft before reloading the saved questions.", color = MaterialTheme.colorScheme.error)
                        if (canControl && drafts.answers.any { it.key.startsWith("$id:") && it.value.isNotBlank() }) TextButton(enabled = !busy, onClick = { discardAnswers = true }) { Text("Reload saved questions") }
                        if (discardAnswers) AlertDialog(onDismissRequest = { discardAnswers = false }, title = { Text("Discard these unsent task answers?") }, confirmButton = { TextButton(onClick = { drafts.answers.keys.filter { it.startsWith("$id:") }.forEach(drafts.answers::remove); drafts.revisions.remove(id); discardAnswers = false }) { Text("Discard answers") } }, dismissButton = { TextButton(onClick = { discardAnswers = false }) { Text("Keep draft") } })
                        if (canControl) Button(enabled = !busy && !stale && pending.isNotEmpty() && pending.all { drafts.answers["$id:${it.optString("id")}"].orEmpty().isNotBlank() }, onClick = {
                            send("/api/autonomous-tasks/$id/answers", JSONObject().put("revision", draftRevision).put("answers", JSONArray(pending.map { JSONObject().put("id", it.optString("id")).put("answer", drafts.answers["$id:${it.optString("id")}"].orEmpty().trim()) }))) { drafts.answers.keys.filter { it.startsWith("$id:") }.forEach(drafts.answers::remove); drafts.revisions.remove(id) }
                        }) { Text("Send task answers") }
                    }
                    if (run.optString("approvalId").isNotBlank() || status == "awaiting_approval") Text("Open Activity & approvals on your PC to review this task's exact approval. This phone cannot approve it.", style = MaterialTheme.typography.bodySmall)
                    if (canControl && status in listOf("running", "queued", "awaiting_answers", "awaiting_approval", "awaiting_result")) OutlinedButton(enabled = !busy, onClick = { send("/api/autonomous-tasks/$id/stop", JSONObject()) }) { Text("Stop autonomous task") }
                    if (canControl && status in listOf("interrupted", "needs_attention", "review_required")) Button(enabled = !busy, onClick = { send("/api/autonomous-tasks/$id/resume", JSONObject().put("revision", revision)) }) { Text("Resume task") }
                    val receipts = run.objects("receipts")
                    if (receipts.isNotEmpty()) TextButton(onClick = { showReceipts = !showReceipts }) { Text(if (showReceipts) "Hide recorded task actions" else "Recorded task actions (${receipts.size})") }
                    if (showReceipts) receipts.forEach { receipt ->
                        Text("${receipt.optString("tool")} · ${receipt.optString("status").replace('_', ' ')}", style = MaterialTheme.typography.labelMedium)
                        if (receipt.optString("summary").isNotBlank()) Text(receipt.optString("summary"), style = MaterialTheme.typography.bodySmall)
                        receipt.optJSONObject("verification")?.let { check -> Text((if (check.optBoolean("verified")) "Observation checked" else "Verification unresolved") + check.optString("summary").let { if (it.isBlank()) "" else ": $it" }, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}
