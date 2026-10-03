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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun LocalChatHistoryControls(history: LocalChatHistory, scopeId: String, revision: Int, onClear: suspend (String) -> Unit) {
    key(scopeId) {
        var open by remember { mutableStateOf(false) }
        TextButton(onClick = { open = true }) { Text("Local history") }
        if (open) LocalHistoryDialog(history, scopeId, revision, onClear) { open = false }
    }
}

@Composable
private fun LocalHistoryDialog(history: LocalChatHistory, scopeId: String, revision: Int, onClear: suspend (String) -> Unit, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<LocalChatArchive>()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<LocalChatArchive?>(null) }
    var messages by remember { mutableStateOf(emptyList<JSONObject>()) }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var generation by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(query, revision, refresh) {
        generation++; selected = null; rows = emptyList(); cursor = null; error = ""; loading = true
        try {
            delay(200)
            val page = withContext(Dispatchers.IO) { history.page(scopeId, query) }
            rows = page.chats; cursor = page.nextCursor
        } catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = failure.message ?: "Could not read local history. Original files have been retained." }
        finally { loading = false }
    }
    LaunchedEffect(selected?.id) {
        messages = emptyList()
        selected?.let { chat -> try { messages = withContext(Dispatchers.IO) { history.transcript(scopeId, chat.id) } }
        catch (failure: CancellationException) { throw failure }
        catch (failure: Exception) { error = failure.message.orEmpty() } }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(0.95f).safeDrawingPadding().padding(12.dp), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Local history", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onClose) { Text("Close") }
                }
                Text("Local and offline replies move here after six hours. Originals and local summaries stay on this device until you clear them; they are never uploaded. Long conversations may have several parts.", style = MaterialTheme.typography.bodySmall)
                if (selected == null) OutlinedTextField(query, { query = it.take(200) }, Modifier.fillMaxWidth(), label = { Text("Search local conversations") }, singleLine = true)
                else TextButton(onClick = { selected = null }) { Text("Back to local chats") }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (selected == null) {
                        if (loading) item { Text("Loading local conversations…") }
                        if (!loading && rows.isEmpty()) item { Text(if (cursor != null) "No matches on this page. Load older chats to continue searching." else "No archived local conversations match this search.") }
                        items(rows, key = { it.id }) { chat -> OutlinedButton(onClick = { selected = chat }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth()) { Text(chat.startedAt, style = MaterialTheme.typography.labelSmall); Text(chat.summary); Text("${chat.count} message parts", style = MaterialTheme.typography.labelSmall) }
                        } }
                        if (cursor != null) item { TextButton(enabled = !loading, onClick = {
                            val ticket = generation; val next = cursor; loading = true
                            scope.launch { try {
                                val page = withContext(Dispatchers.IO) { history.page(scopeId, query, next) }
                                if (generation == ticket) { rows = rows + page.chats; cursor = page.nextCursor }
                            } catch (failure: CancellationException) { throw failure }
                            catch (failure: Exception) { if (generation == ticket) error = failure.message.orEmpty() }
                            finally { if (generation == ticket) loading = false } }
                        }) { Text("Load older local chats") } }
                    } else items(messages, key = { it.getString("id") }) { ChatMessageBubble(it) }
                }
                TextButton(onClick = { confirmClear = true }, enabled = !loading) { Text("Clear local history") }
            }
        }
    }
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text("Clear this local history?") },
        text = { Text("Delete the local originals, summaries and current local messages for this connection from this device. Host chat history and other paired histories are unchanged.") },
        confirmButton = { TextButton(onClick = {
            confirmClear = false; loading = true
            scope.launch { try { onClear(scopeId); refresh++ }
                catch (failure: CancellationException) { throw failure }
                catch (failure: Exception) { error = failure.message.orEmpty() }
                finally { loading = false } }
        }) { Text("Delete local history") } }, dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Keep history") } })
}
