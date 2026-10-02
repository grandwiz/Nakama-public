package dev.nakama.companion

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

class SelfMaintenanceDrafts {
    var identityKey: String? = null
    var title by mutableStateOf("")
    var request by mutableStateOf("")
    var focusedId by mutableStateOf<String?>(null)
    fun clear() { title = ""; request = ""; focusedId = null }
}

@Composable
fun SelfMaintenancePanel(identityKey: String?, allowed: Boolean,
    request: suspend (String, String, JSONObject?) -> JSONObject, openWorkflow: (String, String) -> Unit,
    savedDrafts: SelfMaintenanceDrafts? = null) {
    val drafts = savedDrafts ?: remember { SelfMaintenanceDrafts() }
    val activity = LocalActivity.current as? ComponentActivity ?: return
    var active by remember { mutableStateOf(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentIdentity by rememberUpdatedState(identityKey)
    val currentRequest by rememberUpdatedState(request)
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var detail by remember { mutableStateOf("") }
    var hold by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var loadError by remember { mutableStateOf("") }
    var generation by remember { mutableLongStateOf(0) }
    var reads by remember { mutableLongStateOf(0) }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) { active = false; generation++ } else if (event == Lifecycle.Event.ON_RESUME) active = true }
        activity.lifecycle.addObserver(observer)
        onDispose { active = false; generation++; activity.lifecycle.removeObserver(observer) }
    }
    suspend fun load(expected: String?, token: Long) {
        val read = ++reads
        val response = currentRequest("GET", "/api/self-maintenance", null)
        if (active && currentAllowed && currentIdentity == expected && generation == token && reads == read) {
            rows = response.objects("requests"); detail = response.optJSONObject("capabilities")?.optString("detail").orEmpty()
            hold = response.optJSONObject("settings")?.optBoolean("hold", true) ?: true; loaded = true; loadError = ""
        }
    }
    LaunchedEffect(identityKey, allowed, active) {
        val token = ++generation
        rows = emptyList(); loaded = false; busy = false; error = ""; loadError = ""; detail = ""; hold = true
        if (!allowed || drafts.identityKey != identityKey) drafts.clear()
        drafts.identityKey = identityKey
        if (!active || !allowed || identityKey == null) return@LaunchedEffect
        while (true) {
            if (!busy) try { load(identityKey, token) } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == identityKey && generation == token) loadError = failure.message.orEmpty() }
            delay(6000)
        }
    }
    fun send(route: String, body: JSONObject, onSaved: () -> Unit = {}) {
        if (!active || !allowed || identityKey == null || busy) return
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
    if (!allowed || identityKey == null) { Text("Connect your paired PC and enable Google and project access to view Dynamic upgrade."); return }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Text("Dynamic upgrade", style = MaterialTheme.typography.headlineSmall)
            Text("Save a built-in improvement for Nakama. Your configured team works in an isolated candidate, with manager questions, real checks and two independent reviews. The running app stays separate.", style = MaterialTheme.typography.bodySmall)
            Text(if (hold) "Development is on hold. Saving requests makes no model call. Only you can explicitly release the hold on your PC after allowance returns; no date starts work automatically." else "Start development and review exact package installation approvals on your PC. This phone can request improvements and inspect progress.", style = MaterialTheme.typography.bodySmall)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall)
            if (drafts.focusedId != null) TextButton(onClick = { drafts.focusedId = null }) { Text("Show all upgrade requests") }
        }
        item {
            OutlinedTextField(drafts.title, { drafts.title = it.take(160) }, Modifier.fillMaxWidth(), label = { Text("Improvement title") }, enabled = !busy)
            OutlinedTextField(drafts.request, { drafts.request = it.take(12000) }, Modifier.fillMaxWidth(), label = { Text("What should Nakama improve?") }, minLines = 3, enabled = !busy)
            Text("Describe behavior and acceptance. Keep passwords, private account data and signing keys out of this request.", style = MaterialTheme.typography.bodySmall)
            Button(enabled = !busy && loaded && drafts.title.isNotBlank() && drafts.request.isNotBlank(), onClick = {
                send("/api/self-maintenance", JSONObject().put("title", drafts.title.trim()).put("request", drafts.request.trim())) { drafts.title = ""; drafts.request = "" }
            }) { Text("Save improvement request") }
        }
        if (busy || !loaded && loadError.isBlank()) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (loadError.isNotBlank()) item { Text(loadError, color = MaterialTheme.colorScheme.error) }
        if (loaded && rows.isEmpty()) item { Text("No improvement requests yet.") }
        if (loaded && drafts.focusedId != null && rows.none { it.optString("id") == drafts.focusedId }) item { Text("This upgrade request is outside your current access.") }
        items(rows.filter { drafts.focusedId == null || it.optString("id") == drafts.focusedId }.reversed(), key = { it.optString("id") }) { row ->
            val id = row.optString("id"); val revision = row.optInt("revision"); val workflow = row.optString("workflowId"); val project = row.optString("projectId")
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(row.optString("title"), style = MaterialTheme.typography.titleMedium)
                    MotionStatus(row.optString("status"))
                    Text(row.optString("request"))
                    if (row.optString("detail").isNotBlank()) Text(row.optString("detail"), style = MaterialTheme.typography.bodySmall)
                    if (row.optString("error").isNotBlank()) Text(row.optString("error"), color = MaterialTheme.colorScheme.error)
                    row.optJSONObject("readiness")?.let { readiness ->
                        Text((if (readiness.optBoolean("ready")) "Candidate checks ready: " else "Candidate checks pending: ") + readiness.optString("detail"), style = MaterialTheme.typography.bodySmall)
                        readiness.objects("checks").forEach { Text("${it.optString("name").ifBlank { it.optString("script") }} · ${it.optString("status")}", style = MaterialTheme.typography.labelSmall) }
                        readiness.objects("reviews").forEach { Text("${it.optString("role").ifBlank { it.optString("provider") }} review · ${it.optString("status")}", style = MaterialTheme.typography.labelSmall) }
                    }
                    row.optJSONObject("artifact")?.let { artifact ->
                        Text("Prepared artifact: ${artifact.optString("platform")} ${artifact.optString("version")}", style = MaterialTheme.typography.bodySmall)
                        if (artifact.optString("sha256").isNotBlank()) Text("SHA-256: ${artifact.optString("sha256")}", style = MaterialTheme.typography.labelSmall)
                        Text("A hash alone does not verify a trusted publisher or a healthy installed update. Installation requires exact PC approval.", style = MaterialTheme.typography.bodySmall)
                    }
                    row.optJSONObject("recovery")?.optString("detail")?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    if (row.optString("approvalId").isNotBlank()) Text("Review this update's exact artifact and approval on your PC. Android cannot approve or install it.", style = MaterialTheme.typography.bodySmall)
                    if (BrowserInputPolicy.id(workflow) && BrowserInputPolicy.id(project)) TextButton(onClick = { openWorkflow(workflow, project) }) { Text("Open manager questions and workflow") }
                    if (BrowserInputPolicy.id(id)) {
                        OutlinedButton(enabled = !busy, onClick = { send("/api/self-maintenance/$id/refresh", JSONObject().put("expectedRevision", revision)) }) { Text("Refresh candidate evidence") }
                        if (row.optString("requestedBy") == identityKey && row.optString("status") !in listOf("stopped", "installed", "completed")) TextButton(enabled = !busy, onClick = { send("/api/self-maintenance/$id/stop", JSONObject().put("expectedRevision", revision)) }) { Text("Stop upgrade request") }
                    }
                }
            }
        }
    }
}
