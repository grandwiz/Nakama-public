package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

@Composable
fun ChatHistoryControls(state: JSONObject, deviceId: String, projectId: String, allowed: Boolean,
    request: suspend (String, String, JSONObject?) -> JSONObject, onChanged: suspend () -> Unit) {
    if (!allowed || deviceId.isBlank()) return
    // Removing permission or changing the paired device disposes every archive request and cached result.
    key(deviceId) { ChatHistoryContent(state, deviceId, projectId, request, onChanged) }
}

@Composable
private fun ChatHistoryContent(state: JSONObject, deviceId: String, projectId: String,
    request: suspend (String, String, JSONObject?) -> JSONObject, onChanged: suspend () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var completing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val current = state.optJSONObject("chatHistory")?.objects("chats")?.firstOrNull {
        it.optString("status") == "active" && it.optString("projectId").let { id -> id == projectId || (projectId.isBlank() && (id.isBlank() || id == "null")) } && it.optString("deliveryDeviceId") == deviceId
    }
    suspend fun complete(chat: JSONObject): JSONObject? {
        if (completing) return null
        completing = true; error = ""
        return try {
            val result = request("POST", "/api/chats/${URLEncoder.encode(chat.getString("id"), "UTF-8")}/complete", JSONObject().put("revision", chat.getInt("revision")))
            onChanged(); result.optJSONObject("chat")
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = failure.message ?: "Could not complete this chat."; null }
        finally { completing = false }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { open = true }) { Text("Chat history") }
        if (current != null) TextButton(enabled = current.optBoolean("canComplete") && !completing, onClick = { scope.launch { complete(current) } }) { Text("Complete chat") }
    }
    if (error.isNotBlank() && !open) Text(error, color = MaterialTheme.colorScheme.error)
    if (open) ChatHistoryDialog(request, error, completing, { complete(it) }, { open = false })
}

@Composable
private fun ChatHistoryDialog(request: suspend (String, String, JSONObject?) -> JSONObject, completionError: String,
    completing: Boolean, complete: suspend (JSONObject) -> JSONObject?, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<JSONObject>()) }
    var nextCursor by remember { mutableStateOf("") }
    var selectedId by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var generation by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query) {
        generation++; rows = emptyList(); nextCursor = ""; selectedId = ""; detail = null; error = ""; loading = true
        try {
            delay(200)
            val result = request("GET", "/api/chats?q=${URLEncoder.encode(query.trim(), "UTF-8")}", null)
            rows = result.objects("chats"); nextCursor = result.optString("nextCursor").takeUnless { it == "null" }.orEmpty()
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = failure.message ?: "Could not load chat history." }
        finally { loading = false }
    }
    LaunchedEffect(selectedId) {
        detail = null
        if (selectedId.isNotBlank()) try { detail = request("GET", "/api/chats/${URLEncoder.encode(selectedId, "UTF-8")}", null) }
        catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = failure.message ?: "Could not load this conversation." }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(0.95f).safeDrawingPadding().padding(12.dp), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Chat history", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onClose) { Text("Close") }
                }
                if (selectedId.isBlank()) {
                    Text("Saved on your PC with local summaries. Search original messages and summaries.", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search saved conversations") }, singleLine = true)
                } else TextButton(onClick = { selectedId = "" }) { Text("Back to saved chats") }
                if (error.isNotBlank() || completionError.isNotBlank()) Text(error.ifBlank { completionError }, color = MaterialTheme.colorScheme.error)
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (selectedId.isBlank()) {
                        if (loading) item { Text("Loading conversations…") }
                        if (!loading && rows.isEmpty()) item { Text("No saved conversations match this search.") }
                        items(rows, key = { it.getString("id") }) { chat ->
                            OutlinedButton(onClick = { selectedId = chat.getString("id") }, modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text("${chat.optString("status")} · ${chat.optInt("messageCount")} messages")
                                    Text(chat.optString("startedAt"), style = MaterialTheme.typography.labelSmall)
                                    Text(chat.optString("summary").ifBlank { "Open conversation" })
                                }
                            }
                        }
                        if (nextCursor.isNotBlank()) item {
                            TextButton(enabled = !loading, onClick = {
                                val ticket = generation; val cursor = nextCursor; loading = true
                                scope.launch { try {
                                    val result = request("GET", "/api/chats?q=${URLEncoder.encode(query.trim(), "UTF-8")}&cursor=${URLEncoder.encode(cursor, "UTF-8")}", null)
                                    if (ticket == generation) { rows = rows + result.objects("chats"); nextCursor = result.optString("nextCursor").takeUnless { it == "null" }.orEmpty() }
                                } catch (failure: CancellationException) { throw failure }
                                catch (failure: Exception) { if (ticket == generation) error = failure.message.orEmpty() }
                                finally { if (ticket == generation) loading = false } }
                            }) { Text("Load older chats") }
                        }
                    } else {
                        if (detail == null) item { Text("Loading conversation…") }
                        detail?.let { transcript ->
                            val chat = transcript.getJSONObject("chat")
                            item { Text(chat.optString("summary")) }
                            if (chat.optBoolean("canComplete")) item { TextButton(enabled = !completing, onClick = { scope.launch {
                                complete(chat)?.let { updated ->
                                    rows = rows.map { if (it.optString("id") == updated.optString("id")) updated else it }
                                    if (selectedId == updated.optString("id")) detail = JSONObject(transcript.toString()).put("chat", updated)
                                }
                            } }) { Text("Complete this chat") } }
                            items(transcript.objects("messages"), key = { it.getString("id") }) { ChatMessageBubble(it) }
                        }
                    }
                }
            }
        }
    }
}
