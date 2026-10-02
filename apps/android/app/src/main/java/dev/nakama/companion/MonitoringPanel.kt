package dev.nakama.companion

import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

private fun JSONObject.monitorValue(key: String): String = optString(key).takeUnless { it == "null" }.orEmpty()

class MonitoringDrafts {
    var identityKey: String? = null
    var title by mutableStateOf("")
    var kind by mutableStateOf("website")
    var conditionType by mutableStateOf("stock")
    var target by mutableStateOf("")
    var contains by mutableStateOf("")
    var excludes by mutableStateOf("")
    var cadence by mutableStateOf("60")
    var focusedId by mutableStateOf<String?>(null)
    fun clear() { title = ""; kind = "website"; conditionType = "stock"; target = ""; contains = ""; excludes = ""; cadence = "60"; focusedId = null }
}

@Composable
fun MonitoringPanel(identityKey: String?, allowed: Boolean, browserAllowed: Boolean,
    request: suspend (String, String, JSONObject?) -> JSONObject, openBrowser: (String) -> Unit,
    savedDrafts: MonitoringDrafts? = null) {
    val drafts = savedDrafts ?: remember { MonitoringDrafts() }
    val context = LocalContext.current
    val activity = LocalActivity.current as? ComponentActivity ?: return
    var active by remember { mutableStateOf(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentBrowserAllowed by rememberUpdatedState(browserAllowed)
    val currentIdentity by rememberUpdatedState(identityKey)
    val currentRequest by rememberUpdatedState(request)
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var detail by remember { mutableStateOf("") }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var loadError by remember { mutableStateOf("") }
    var generation by remember { mutableLongStateOf(0) }
    var reads by remember { mutableLongStateOf(0) }
    var confirm by remember { mutableStateOf<JSONObject?>(null) }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) { active = false; confirm = null; generation++ } else if (event == Lifecycle.Event.ON_RESUME) active = true }
        activity.lifecycle.addObserver(observer)
        onDispose { active = false; generation++; activity.lifecycle.removeObserver(observer) }
    }
    suspend fun load(expected: String?, token: Long) {
        val read = ++reads
        val response = currentRequest("GET", "/api/monitors", null)
        if (active && currentAllowed && currentIdentity == expected && generation == token && reads == read) {
            rows = response.objects("monitors"); detail = response.optString("detail"); loaded = true; loadError = ""
        }
    }
    LaunchedEffect(identityKey, allowed, active) {
        val token = ++generation
        rows = emptyList(); loaded = false; error = ""; loadError = ""; detail = ""; confirm = null; busy = false
        if (!allowed || drafts.identityKey != identityKey) drafts.clear()
        drafts.identityKey = identityKey
        if (!active || !allowed || identityKey == null) return@LaunchedEffect
        while (true) {
            if (!busy) try { load(identityKey, token) } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == identityKey && generation == token) loadError = failure.message.orEmpty() }
            delay(6000)
        }
    }
    fun send(method: String, route: String, body: JSONObject, onSaved: (JSONObject) -> Unit = {}) {
        if (!active || !allowed || identityKey == null || busy) return
        val expected = identityKey; val token = generation
        busy = true; reads++; error = ""
        scope.launch {
            try {
                val response = currentRequest(method, route, body)
                if (currentAllowed && currentIdentity == expected && generation == token) { onSaved(response); load(expected, token) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == expected && generation == token) error = failure.message.orEmpty() }
            finally { if (generation == token) busy = false }
        }
    }
    fun action(row: JSONObject, name: String, extra: JSONObject = JSONObject(), onSaved: (JSONObject) -> Unit = {}) {
        val id = row.optString("id")
        if (!BrowserInputPolicy.id(id)) return
        send("POST", "/api/monitors/$id/$name", extra.put("revision", row.optInt("revision")), onSaved)
    }
    if (!allowed || identityKey == null) { Text("Connect your paired PC and enable Google and project access to use monitoring."); return }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Text("Monitoring", style = MaterialTheme.typography.headlineSmall)
            Text("Checks use local rules without model calls. Your Windows host must stay awake. Payment and CAPTCHA completion are yours; detection does not guarantee stock or a purchase.", style = MaterialTheme.typography.bodySmall)
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall)
            Text("Phone alerts need notification permission and the open app or visible Mote. Delivery while offline or stopped is not guaranteed.", style = MaterialTheme.typography.bodySmall)
            if (drafts.focusedId != null) TextButton(onClick = { drafts.focusedId = null }) { Text("Show all monitors") }
        }
        item {
            OutlinedTextField(drafts.title, { drafts.title = it.take(100) }, Modifier.fillMaxWidth(), label = { Text("Monitor name") }, enabled = !busy)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                listOf("website" to "Website", "android_app" to "This Android app").forEach { (kind, label) ->
                    FilterChip(drafts.kind == kind, { drafts.kind = kind; drafts.conditionType = if (kind == "website") "stock" else "text"; drafts.target = "" }, label = { Text(label) }, enabled = !busy)
                }
            }
            OutlinedTextField(drafts.target, { drafts.target = it.take(2048) }, Modifier.fillMaxWidth(), label = { Text(when (drafts.kind) { "website" -> "Public HTTPS page URL"; "windows_app" -> "Exact process name, e.g. example.exe"; else -> "Exact Android package, e.g. com.example.reader" }) }, enabled = !busy, singleLine = true)
            if (drafts.kind == "website") Row {
                FilterChip(drafts.conditionType == "stock", { drafts.conditionType = "stock" }, label = { Text("Product stock data") }, enabled = !busy)
                FilterChip(drafts.conditionType == "text", { drafts.conditionType = "text" }, label = { Text("Exact visible text") }, enabled = !busy)
            }
            if (drafts.conditionType == "text") {
                OutlinedTextField(drafts.contains, { drafts.contains = it.take(200) }, Modifier.fillMaxWidth(), label = { Text("Visible text must contain") }, enabled = !busy)
                OutlinedTextField(drafts.excludes, { drafts.excludes = it.take(200) }, Modifier.fillMaxWidth(), label = { Text("Must not contain (optional)") }, enabled = !busy)
            } else Text("Uses the page's product stock evidence. Missing or ambiguous evidence pauses for review.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(drafts.cadence, { drafts.cadence = it.filter(Char::isDigit).take(5) }, Modifier.fillMaxWidth(), label = { Text("Seconds between checks (30–86400)") }, enabled = !busy, singleLine = true)
            Button(enabled = !busy && loaded && drafts.title.isNotBlank() && drafts.target.isNotBlank() && (drafts.conditionType == "stock" || drafts.contains.isNotBlank()) && (drafts.cadence.toIntOrNull() ?: 0) in 30..86400 && (drafts.kind != "website" || browserAllowed), onClick = {
                val condition = JSONObject().put("type", drafts.conditionType).apply { if (drafts.conditionType == "text") { put("contains", drafts.contains.trim()); put("excludes", drafts.excludes.trim()) } }
                val body = JSONObject().put("title", drafts.title.trim()).put("kind", drafts.kind).put("condition", condition).put("intervalSeconds", drafts.cadence.toInt())
                when (drafts.kind) { "website" -> body.put("url", drafts.target.trim()); "windows_app" -> body.put("processName", drafts.target.trim()); else -> body.put("deviceId", identityKey).put("packageName", drafts.target.trim()) }
                send("POST", "/api/monitors", body) { drafts.clear() }
            }) { Text("Save paused monitor") }
            Text("Create Windows app monitors, confirm shopping setup, approve checkout preparation, forget profiles and remove monitors on your PC.", style = MaterialTheme.typography.bodySmall)
            if (drafts.kind == "website" && !browserAllowed) Text("Enable Browser control for this phone on your PC before creating a website monitor.", style = MaterialTheme.typography.bodySmall)
        }
        if (busy || !loaded && loadError.isBlank()) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (loadError.isNotBlank()) item { Text(loadError, color = MaterialTheme.colorScheme.error) }
        if (loaded && rows.isEmpty()) item { Text("No monitors yet.") }
        if (loaded && drafts.focusedId != null && rows.none { it.optString("id") == drafts.focusedId }) item { Text("This monitor is resolved or outside your current access.") }
        items(rows.filter { drafts.focusedId == null || it.optString("id") == drafts.focusedId }.reversed(), key = { it.optString("id") }) { row ->
            val status = row.optString("status"); val id = row.optString("id"); val kind = row.optString("kind")
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(row.optString("title"), style = MaterialTheme.typography.titleMedium)
                    MotionStatus(status)
                    Text("Last result: ${row.monitorValue("lastOutcome").ifBlank { "Not checked" }.replace('_', ' ')}", style = MaterialTheme.typography.bodySmall)
                    if (row.optString("detail").isNotBlank()) Text(row.optString("detail"), style = MaterialTheme.typography.bodySmall)
                    if (row.monitorValue("lastCheckedAt").isNotBlank()) Text("Last check: ${row.monitorValue("lastCheckedAt")}", style = MaterialTheme.typography.labelSmall)
                    if (row.monitorValue("nextCheckAt").isNotBlank()) Text("Next check: ${row.monitorValue("nextCheckAt")}", style = MaterialTheme.typography.labelSmall)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (status in listOf("active", "checking")) OutlinedButton(enabled = !busy, onClick = { PhoneMonitorObserver.stop(context, id); action(row, "pause") }) { Text("Pause monitor") }
                        if (status in listOf("paused", "attention")) Button(enabled = !busy, onClick = { action(row, "resume") }) { Text("Resume monitor") }
                        if (kind != "android_app" && status == "active") OutlinedButton(enabled = !busy, onClick = { action(row, "check") }) { Text("Check now") }
                        if (status == "attention") TextButton(enabled = !busy, onClick = { action(row, "acknowledge") }) { Text("Acknowledge") }
                    }
                    if (kind == "website") {
                        Text("Sign in and confirm delivery details privately. Saved cookies stay in Nakama's dedicated PC profile. Never enter passwords or payment details into a monitor rule.", style = MaterialTheme.typography.bodySmall)
                        val recipe = row.optJSONObject("checkoutRecipe") ?: row.optJSONObject("recipe")
                        if (recipe != null) Text("Checkout preparation: ${if (recipe.optBoolean("enabled")) "PC-approved recipe" else "Disabled"}. Review its exact limits on your PC.", style = MaterialTheme.typography.bodySmall)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            listOf("setup" to "Open private setup", "captcha" to "Open CAPTCHA", "checkout" to "Open checkout").forEach { (reason, label) ->
                                TextButton(enabled = !busy && browserAllowed, onClick = { action(row, "open", JSONObject().put("reason", reason)) { result ->
                                    val session = result.optString("sessionId").ifBlank { result.optJSONObject("outcome")?.optString("browserSessionId").orEmpty() }
                                    if (currentBrowserAllowed && BrowserInputPolicy.id(session)) openBrowser(session)
                                } }) { Text(label) }
                            }
                        }
                        if (!browserAllowed) Text("Enable Browser control for this phone on your PC to open private pages.", style = MaterialTheme.typography.bodySmall)
                        Text("Private setup confirmation and forgetting this shopping profile are available on your PC.", style = MaterialTheme.typography.bodySmall)
                    }
                    if (kind == "android_app" && row.optString("deviceId") == identityKey) {
                        Text("Read-only observation needs this exact app visible and unlocked, Accessibility enabled and Mote running. Only a match status leaves the phone. Login/payment screens stop observation.", style = MaterialTheme.typography.bodySmall)
                        Text(PhoneMonitorObserver.status, style = MaterialTheme.typography.bodySmall)
                        if (PhoneMonitorObserver.activeId == id) OutlinedButton(onClick = { PhoneMonitorObserver.stop(context, id) }) { Text("Stop phone observation") }
                        else Button(enabled = !busy && status == "active", onClick = { confirm = row }) { Text("Allow read-only observation…") }
                    }
                }
            }
        }
    }
    confirm?.let { row ->
        val prompt = "Allow local read-only checks of ${row.optString("packageName")} for up to 30 minutes while Mote is visible? Rule: ${row.optJSONObject("condition")?.optString("contains").orEmpty()}. Only match/no-match or unavailable status goes to your PC. This does not allow taps or typing. Locking the phone or stopping Mote ends consent."
        AlertDialog(onDismissRequest = { confirm = null }, title = { Text("Read-only phone monitoring") }, text = { Text(prompt) },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                confirm = null
                val readiness = PhoneMonitorObserver.readiness(context, row.optString("packageName"))
                if (readiness != null) error = readiness
                else action(row, "observe-consent", JSONObject().put("packageName", row.optString("packageName"))) { response ->
                    val updated = response.optJSONObject("monitor") ?: row
                    error = PhoneMonitorObserver.start(context, updated, response.optString("consentId"), response.optString("expiresAt")).orEmpty()
                }
            }) { Text("Allow for 30 minutes") } }, dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } })
    }
}
