package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

@Composable
fun ProjectImportPanel(allowed: Boolean, request: suspend (String, String, JSONObject?) -> JSONObject, onImported: (String) -> Unit, onClose: () -> Unit) {
    var roots by remember { mutableStateOf(emptyList<JSONObject>()) }
    var rootId by remember { mutableStateOf("") }
    var path by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(allowed) {
        roots = emptyList(); folder = null
        if (allowed) try { roots = request("GET", "/api/project-imports/roots", null).objects("roots"); rootId = roots.firstOrNull()?.optString("id").orEmpty() } catch (failure: Exception) { error = failure.message.orEmpty() }
    }
    LaunchedEffect(rootId, path, allowed) {
        folder = null
        if (allowed && rootId.isNotBlank()) try { folder = request("GET", "/api/project-imports/browse?rootId=${URLEncoder.encode(rootId, "UTF-8")}&path=${URLEncoder.encode(path, "UTF-8")}", null) } catch (failure: Exception) { error = failure.message.orEmpty() }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = onClose) { Text("← Projects") }
        Text("Import a Windows project", style = MaterialTheme.typography.headlineSmall)
        Text("Browse the project libraries selected on your PC. Existing files stay in place; importing does not execute project instructions.")
        if (!allowed) Text("Project access is required.")
        if (allowed && roots.isEmpty()) Text("In Control Center → Projects → Import existing folder, add the Windows folder containing your GPT or Claude projects.")
        roots.forEach { row -> OutlinedButton(onClick = { rootId = row.optString("id"); path = ""; error = "" }, enabled = allowed && !busy) { Text(row.optString("name")) } }
        Text(path.ifBlank { "Library root" })
        if (path.isNotBlank()) TextButton(onClick = { path = path.substringBeforeLast('/', "") }, enabled = !busy) { Text("Up one folder") }
        folder?.let { current ->
            Text(current.optJSONArray("detected")?.let { array -> (0 until array.length()).joinToString(" · ") { array.optString(it) } }.orEmpty())
            Button(enabled = allowed && !busy && current.optBoolean("canImport"), onClick = {
                busy = true; error = ""
                scope.launch { try { val result = request("POST", "/api/project-imports", JSONObject().put("rootId", rootId).put("path", current.optString("path"))); onImported(result.getJSONObject("project").getString("id")) } catch (failure: Exception) { error = failure.message.orEmpty() } finally { busy = false } }
            }) { Text(if (busy) "Importing…" else "Import this folder") }
            current.objects("entries").forEach { row -> OutlinedButton(onClick = { path = row.optString("path"); error = "" }, enabled = !busy) { Text("${row.optString("name")} →") } }
        }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    }
}
