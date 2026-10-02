package dev.nakama.companion

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import org.json.JSONObject

@Composable
fun ProjectFilesPanel(projectId: String, projectName: String, allowed: Boolean, request: suspend (String, String, JSONObject?) -> JSONObject, onBack: () -> Unit, openChat: () -> Unit) {
    val scope = rememberCoroutineScope(); val currentAllowed by rememberUpdatedState(allowed); val currentProject by rememberUpdatedState(projectId)
    var folder by remember(projectId) { mutableStateOf("") }; var page by remember { mutableStateOf("Files") }
    var entries by remember(projectId) { mutableStateOf<List<JSONObject>>(emptyList()) }; var reports by remember(projectId) { mutableStateOf<JSONObject?>(null) }
    var query by remember { mutableStateOf("") }; var searchResults by remember { mutableStateOf<List<JSONObject>?>(null) }
    var detail by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    var document by remember(projectId) { mutableStateOf<ProjectDocument?>(null) }; var documentPath by remember { mutableStateOf("") }; var reportId by remember { mutableStateOf("") }
    var generation by remember { mutableLongStateOf(0L) }
    val base = "/api/projects/$projectId"
    suspend fun listing(path: String): List<JSONObject> = request("GET", "$base/files?path=${ProjectFilePolicy.query(path)}", null).objects("entries").filter { ProjectFilePolicy.relative(it.optString("path")) && it.optString("type") in listOf("file", "directory") }
    suspend fun read(path: String, report: String = ""): ProjectDocument = withContext(Dispatchers.Default) {
        if (report.isNotBlank()) ProjectFilePolicy.binary(request("GET", "$base/reports/$report/file", null))
        else if (path.substringAfterLast('.').lowercase() in listOf("png", "jpg", "jpeg", "pdf")) ProjectFilePolicy.binary(request("GET", "$base/file-preview?path=${ProjectFilePolicy.query(path)}", null))
        else ProjectFilePolicy.text(path, request("GET", "$base/file?path=${ProjectFilePolicy.query(path)}", null).getString("content"))
    }
    LaunchedEffect(projectId, folder, allowed) {
        val token = ++generation; entries = emptyList(); searchResults = null; document = null; query = ""; detail = ""; error = ""
        if (!allowed) { reports = null; busy = false; return@LaunchedEffect }
        busy = true
        try { val result = listing(folder); if (currentAllowed && token == generation) entries = result }
        catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed && token == generation) error = failure.message.orEmpty() }
        finally { if (token == generation) busy = false }
    }
    LaunchedEffect(projectId, page, allowed) {
        if (!allowed || page != "Reports") return@LaunchedEffect
        val expectedProject = projectId
        while (isActive) {
            try { val result = request("GET", "$base/reports", null); if (currentAllowed && currentProject == expectedProject) { check(result.optInt("version") == 1); reports = result } }
            catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed) error = failure.message.orEmpty() }
            delay(5000)
        }
    }
    fun open(path: String, report: String = "") {
        if (!allowed || busy) return
        val token = ++generation; busy = true; error = ""; document = null
        scope.launch { try { val result = read(path, report); if (currentAllowed && token == generation) { documentPath = path; reportId = report; document = result } }
        catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed && token == generation) error = failure.message.orEmpty() }
        finally { if (token == generation) busy = false } }
    }
    fun search() {
        if (!allowed || busy || query.isBlank()) return
        val token = ++generation; val wanted = query.trim(); busy = true; error = ""; detail = "Searching project filenames…"
        scope.launch {
            try {
                val queue = ArrayDeque<String>().apply { add("") }; val seen = mutableSetOf<String>(); val matches = mutableListOf<JSONObject>(); var count = 0
                while (queue.isNotEmpty() && seen.size < 40 && count < 2000 && currentAllowed && token == generation) {
                    val next = queue.removeFirst(); if (!seen.add(next)) continue
                    val children = listing(next); count += children.size
                    for (entry in children) {
                        if (entry.optString("name").contains(wanted, true)) matches += entry
                        if (entry.optString("type") == "directory") queue += entry.optString("path")
                    }
                }
                if (currentAllowed && token == generation) { searchResults = matches; detail = "${matches.size} matches in ${seen.size} folders." + if (queue.isNotEmpty() || count >= 2000) " Search limit reached; narrow by folder. Directory listings show at most 500 entries." else " Directory listings show at most 500 entries." }
            } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed && token == generation) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        }
    }
    fun reportAction(method: String, route: String, body: JSONObject) {
        if (!allowed || busy) return
        val token = generation; busy = true; error = ""
        scope.launch { try { request(method, route, body); val next = request("GET", "$base/reports", null); if (currentAllowed && token == generation) reports = next }
        catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed && token == generation) error = failure.message.orEmpty() }
        finally { if (token == generation) busy = false } }
    }
    if (!allowed) { Column { TextButton(onClick = onBack) { Text("Back to projects") }; Text("Connect your paired PC and enable Google and project access to view files and reports.") }; return }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row { TextButton(onClick = onBack) { Text("Back to projects") }; TextButton(onClick = openChat) { Text("Project chat") } }
        Text(projectName.ifBlank { "Project files" }, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Files", "Reports").forEach { name -> FilterChip(page == name, onClick = { page = name }, label = { Text(name) }) } }
        if (busy) NakamaBusy(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        if (page == "Files") {
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                TextButton(onClick = { folder = ""; searchResults = null; query = "" }) { Text("Project root") }
                var path = ""
                folder.split('/').filter(String::isNotEmpty).forEach { segment -> path = listOf(path, segment).filter(String::isNotEmpty).joinToString("/"); val target = path; TextButton(onClick = { folder = target }) { Text("/ $segment") } }
            }
            OutlinedTextField(query, { query = it.take(120); searchResults = null }, Modifier.fillMaxWidth(), label = { Text("Filter this folder by filename") }, singleLine = true, enabled = !busy)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedButton(onClick = ::search, enabled = !busy && query.isNotBlank()) { Text("Search project filenames") }; if (searchResults != null) TextButton(onClick = { searchResults = null; detail = "" }) { Text("Back to folder") } }
            if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodySmall)
            val visible = searchResults ?: entries.filter { query.isBlank() || it.optString("name").contains(query, true) }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (visible.isEmpty() && !busy) item { Text("No matching files or folders.") }
                items(visible, key = { it.optString("path") }) { entry ->
                    OutlinedButton(enabled = !busy, onClick = { if (entry.optString("type") == "directory") folder = entry.optString("path") else open(entry.optString("path")) }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) { Text((if (entry.optString("type") == "directory") "Folder · " else "File · ") + entry.optString("name")); if (searchResults != null) Text(entry.optString("path"), style = MaterialTheme.typography.labelSmall) }
                    }
                }
                item { Text("Read-only previews: text up to 1 MB; PNG, JPEG or PDF up to 1.3 MB. Files stay in the PC workspace unless you explicitly save a copy. Protected/linked files are rejected.", style = MaterialTheme.typography.bodySmall) }
            }
        } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("Project PDF reports", style = MaterialTheme.typography.titleLarge); Text("Generate or open a report from recorded project work. A ready PDF is a report, not proof that deployment or physical tests passed.", style = MaterialTheme.typography.bodySmall) }
                reports?.let { data ->
                    item { Row { Text("Automatic project reports", Modifier.weight(1f).padding(top = 12.dp)); Switch(data.optBoolean("automaticEnabled"), { reportAction("PATCH", "$base/reports/settings", JSONObject().put("automaticEnabled", it)) }, enabled = !busy) } }
                    if (!data.optBoolean("available")) item { Text("Report generation is unavailable on this host. Open Control Center on your PC.") }
                    item { Button(enabled = !busy && data.optBoolean("available") && !data.optBoolean("busy"), onClick = { reportAction("POST", "$base/reports", JSONObject()) }) { Text("Generate project report") } }
                    items(data.objects("reports"), key = { it.optString("id") }) { report ->
                        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) { Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(report.optString("fileName")); MotionStatus(report.optString("status")); Text(report.optString("createdAt"), style = MaterialTheme.typography.labelSmall)
                            if (report.optString("error").isNotBlank()) Text(report.optString("error"), color = MaterialTheme.colorScheme.error)
                            if (report.optString("status") == "ready") TextButton(enabled = !busy, onClick = { open("", report.optString("id")) }) { Text("Open PDF report") }
                        } }
                    }
                    if (data.objects("reports").isEmpty()) item { Text("No reports yet.") }
                } ?: item { Text("Loading report availability…") }
            }
        }
    }
    document?.let { value -> ProjectPreview(value, allowed, { document = null }) { check(currentAllowed); read(documentPath, reportId) } }
}
