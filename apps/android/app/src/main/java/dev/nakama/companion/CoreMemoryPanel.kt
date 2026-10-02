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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun CoreMemoryPanel(identityKey: String?, allowed: Boolean, request: suspend (String, String, JSONObject?) -> JSONObject) {
    val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentIdentity by rememberUpdatedState(identityKey)
    var entries by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var editId by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("note") }
    var generation by remember { mutableLongStateOf(0L) }
    suspend fun load(expected: String?, token: Long) {
        val result = request("GET", "/api/core-memory", null)
        if (currentAllowed && currentIdentity == expected && token == generation) { entries = result.objects("entries"); loaded = true }
    }
    LaunchedEffect(identityKey, allowed) {
        val token = ++generation
        entries = emptyList(); loaded = false; editId = null; text = ""; error = ""
        if (allowed && identityKey != null) {
            busy = true
            try { load(identityKey, token) } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == identityKey && token == generation) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        } else busy = false
    }
    fun mutate(method: String, path: String, body: JSONObject? = null) {
        if (!allowed || busy || identityKey == null) return
        val expected = identityKey; val token = generation
        busy = true; error = ""
        scope.launch {
            try {
                request(method, path, body)
                if (currentAllowed && currentIdentity == expected && token == generation) { editId = null; text = ""; load(expected, token) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (currentAllowed && currentIdentity == expected && token == generation) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        }
    }
    if (!allowed || identityKey == null) { Text("Connect your paired PC and enable Google and project access to see Core Memory."); return }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text("Core Memory", style = MaterialTheme.typography.headlineSmall); Text("Your saved notes and Nakama's personality. Editable context, not model training or permission to act. Learning controls are on your PC.", style = MaterialTheme.typography.bodySmall) }
        item { Button(enabled = !busy, onClick = { editId = ""; text = ""; category = "note" }) { Text("Add memory") } }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error); TextButton(enabled = !busy, onClick = {
            val token = generation; busy = true
            scope.launch { try { load(identityKey, token); error = "" } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed && token == generation) error = failure.message.orEmpty() } finally { if (token == generation) busy = false } }
        }) { Text("Retry memory") } }
        if (loaded && entries.isEmpty()) item { Text("No saved notes yet. You can also say 'remember that…' in Chat.") }
        items(entries, key = { it.optString("id") }) { entry ->
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(entry.optString("category"), style = MaterialTheme.typography.labelMedium)
                    Text(entry.optString("text"))
                    Row { TextButton(enabled = !busy, onClick = { editId = entry.optString("id"); text = entry.optString("text"); category = entry.optString("category") }) { Text("Edit memory") }; TextButton(enabled = !busy, onClick = { mutate("DELETE", "/api/core-memory/${entry.optString("id")}") }) { Text("Forget memory") } }
                }
            }
        }
    }
    editId?.let { id ->
        AlertDialog(onDismissRequest = { if (!busy) editId = null }, title = { Text(if (id.isBlank()) "Add memory" else "Edit memory") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Use one line, up to 500 characters. Do not include credentials.", style = MaterialTheme.typography.bodySmall)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("note", "preference", "trait", "routine", "personality").forEach { value -> FilterChip(selected = category == value, onClick = { category = value }, enabled = !busy, label = { Text(value) }) } }
                OutlinedTextField(text, { text = it.replace(Regex("[\\x00-\\x1f\\x7f]"), " ").take(500) }, label = { Text("Saved note") }, modifier = Modifier.fillMaxWidth(), enabled = !busy, minLines = 3)
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = { TextButton(enabled = !busy && text.isNotBlank(), onClick = { mutate(if (id.isBlank()) "POST" else "PATCH", "/api/core-memory" + if (id.isBlank()) "" else "/$id", JSONObject().put("text", text.trim()).put("category", category)) }) { Text("Save memory") } }, dismissButton = { TextButton(enabled = !busy, onClick = { editId = null; text = "" }) { Text("Cancel") } })
    }
}
