package dev.nakama.companion

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

object GithubDraftPolicy {
    fun repository(value: String): Boolean = Regex("(?:https://github\\.com/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\\.git)?/?").matches(value.trim()) && !value.contains("..")
    fun author(name: String, email: String) = name.trim().isNotEmpty() && name.length <= 100 && !name.contains(Regex("[\\r\\n<>]")) && email.length <= 254 && email.matches(Regex("[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+"))
    fun message(value: String) = value.trim().length in 1..500 && !value.contains(Regex("[\\x00-\\x1f\\x7f]"))
}

/** All operations use the paired host. This page never contains a phone-side approval endpoint. */
@Composable
fun GithubProjectPanel(projectId: String?, state: JSONObject, allowed: Boolean, request: suspend (String, String, JSONObject?) -> JSONObject, refresh: suspend () -> Unit, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentProject by rememberUpdatedState(projectId)
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf("") }
    var generation by remember { mutableLongStateOf(0L) }
    var account by remember { mutableStateOf("") }
    var repository by remember { mutableStateOf("") }
    var projectName by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var editingCommit by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var authorName by remember { mutableStateOf("") }
    var authorEmail by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var previewKind by remember { mutableStateOf("") }
    val base = "/api/projects/$projectId/github"
    fun valid(expected: String?, token: Long) = currentAllowed && currentProject == expected && generation == token
    suspend fun load(expected: String?, token: Long) {
        if (expected == null) return
        val result = request("GET", "/api/projects/$expected/github", null)
        if (valid(expected, token)) { data = result; selected = selected.intersect(result.optJSONObject("status")?.objects("entries").orEmpty().map { it.optString("path") }.toSet()) }
    }
    LaunchedEffect(projectId, allowed) {
        val token = ++generation; data = null; error = ""; receipt = ""; preview = null; selected = emptySet(); editingCommit = false; busy = false
        if (!allowed) { account = ""; repository = ""; projectName = ""; message = ""; authorName = ""; authorEmail = "" }
        if (allowed && projectId != null) {
            busy = true
            try { load(projectId, token) } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (valid(projectId, token)) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        }
    }
    fun operate(path: String, body: JSONObject = JSONObject(), kind: String = "") {
        if (!allowed || busy) return
        val expected = projectId; val token = generation; busy = true; error = ""
        scope.launch {
            try {
                val result = request("POST", path, body)
                if (valid(expected, token)) {
                    if (kind in listOf("commit_preview", "push_preview")) { preview = result; previewKind = kind }
                    else {
                        preview = null
                        receipt = when (kind) {
                            "push" -> "Push requested. Review and approve this exact push in Activity & approvals on your PC. Request ${result.optString("id", result.optJSONObject("approval")?.optString("id").orEmpty())}. This is not a completed push."
                            "commit" -> "Commit recorded on your PC${result.optString("commit").takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()}. It has not been pushed."
                            "import" -> "Repository imported on your PC. Return to Projects to open it."
                            "link" -> "Repository linked to this project."
                            "fetch" -> "Remote references fetched. Project files were not pulled."
                            "pull" -> "Fast-forward pull completed on your PC."
                            else -> result.optString("message").ifBlank { "Operation completed on your PC." }
                        }
                        if (kind == "commit") { selected = emptySet(); editingCommit = false; message = "" }
                        load(expected, token); refresh()
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (valid(expected, token)) { error = failure.message.orEmpty(); if (kind in listOf("commit", "push")) preview = null } }
            finally { if (token == generation) busy = false }
        }
    }
    if (!allowed) { Column { TextButton(onClick = onBack) { Text("Back to projects") }; Text("Connect your paired PC and enable Google and project access to use GitHub. Connect a labelled GitHub account on your PC.") }; return }
    val accounts = state.objects("connections").firstOrNull { it.optString("id") == "github" }?.objects("accounts").orEmpty()
    val chosenAccount = accounts.firstOrNull { it.optString("id") == account }
    val status = data?.optJSONObject("status")
    val entries = status?.objects("entries").orEmpty()
    val linked = data?.optBoolean("linked") == true
    val hostBusy = data?.optBoolean("busy") == true
    val enabled = !busy && !hostBusy
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { TextButton(onClick = onBack) { Text("Back to projects") }; Text(if (projectId == null) "Import from GitHub" else "GitHub repository", style = MaterialTheme.typography.headlineSmall) }
        item { Text("Git runs in your PC workspace using its selected GitHub account. Pushes always wait for PC approval because they may trigger deployment workflows.", style = MaterialTheme.typography.bodySmall) }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (hostBusy) item { Text("This repository is busy on the PC. Refresh when that operation finishes.") }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (receipt.isNotBlank()) item { Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) { Text(receipt, Modifier.padding(14.dp)) } }
        if (projectId == null || data != null && !linked) {
            item { Text(if (projectId == null) "Choose the account and exact repository to clone." else "Link this existing Git checkout to its exact GitHub repository.") }
            if (accounts.isEmpty()) item { Text("No labelled GitHub account is available. Add one in Control Center → Connections on your PC; tokens stay there.") }
            items(accounts, key = { "account-${it.optString("id")}" }) { row ->
                FilterChip(selected = account == row.optString("id"), enabled = enabled, onClick = { account = row.optString("id") }, label = { Text("${row.optString("name", row.optString("accountLabel"))} · ${row.optString("status")}") })
            }
            item { OutlinedTextField(repository, { repository = it.take(250) }, modifier = Modifier.fillMaxWidth(), label = { Text("GitHub owner/repository or HTTPS URL") }, singleLine = true, enabled = enabled) }
            if (projectId == null) item { OutlinedTextField(projectName, { projectName = it.take(80) }, modifier = Modifier.fillMaxWidth(), label = { Text("Project name · optional") }, singleLine = true, enabled = enabled) }
            item { Button(enabled = enabled && GithubDraftPolicy.repository(repository) && chosenAccount != null, onClick = {
                val body = JSONObject().put("accountId", account).put("repository", repository.trim())
                if (projectName.isNotBlank() && projectId == null) body.put("name", projectName.trim())
                operate(if (projectId == null) "/api/github/import" else "$base/link", body, if (projectId == null) "import" else "link")
            }) { Text(if (projectId == null) "Import repository" else "Link repository") } }
        }
        if (projectId != null) item { TextButton(enabled = !busy, onClick = {
            val expected = projectId; val token = generation; busy = true; error = ""
            scope.launch { try { load(expected, token) } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (valid(expected, token)) error = failure.message.orEmpty() } finally { if (token == generation) busy = false } }
        }) { Text("Refresh repository") } }
        data?.optJSONObject("link")?.let { link -> item { Text(link.optString("repository"), style = MaterialTheme.typography.titleMedium); Text("Account: ${link.optString("accountLabel")}\nDefault branch: ${link.optString("defaultBranch")}", style = MaterialTheme.typography.bodySmall) } }
        status?.let { git ->
            item { Text("Branch: ${git.optString("branch").ifBlank { "Unavailable" }}\nHEAD: ${git.optString("head").ifBlank { "No commit recorded" }}", style = MaterialTheme.typography.bodySmall)
                if (git.has("ahead")) Text("Ahead ${git.optInt("ahead")} · Behind ${git.optInt("behind")} (last fetched)", style = MaterialTheme.typography.bodySmall)
                if (!git.optBoolean("available")) Text(git.optString("reason", git.optString("detail", "Git status is unavailable.")))
            }
        }
        if (linked) item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = enabled, onClick = { operate("$base/fetch", kind = "fetch") }) { Text("Fetch") }
            OutlinedButton(enabled = enabled && entries.isEmpty() && status?.optBoolean("truncated") != true, onClick = { operate("$base/pull", kind = "pull") }) { Text("Pull fast-forward") }
            OutlinedButton(enabled = enabled, onClick = { operate("$base/push/prepare", kind = "push_preview") }) { Text("Review push") }
        } }
        if (status?.optBoolean("available") == true) item { Text("Working changes", style = MaterialTheme.typography.titleMedium); Text("Select exact paths for a local commit. Review includes the author identity you enter; committing records it in Git history.", style = MaterialTheme.typography.bodySmall) }
        if (status?.optBoolean("truncated") == true) item { Text("Status is incomplete. Use Git on your PC for this repository; commit preparation is disabled.", color = MaterialTheme.colorScheme.error) }
        items(entries, key = { "path-${it.optString("path")}" }) { entry ->
            val path = entry.optString("path")
            Row(Modifier.fillMaxWidth()) { Checkbox(path in selected, { selected = if (it) selected + path else selected - path }, enabled = enabled && !editingCommit && status?.optBoolean("truncated") != true); Column(Modifier.weight(1f).padding(top = 8.dp)) { Text(path); Text("${entry.optString("indexStatus")} ${entry.optString("worktreeStatus")}" + entry.optString("originalPath").takeIf { it.isNotBlank() }?.let { " · from $it" }.orEmpty(), style = MaterialTheme.typography.labelSmall) } }
        }
        if (entries.isEmpty() && status?.optBoolean("available") == true) item { Text("Working tree is clean in the latest snapshot.") }
        if (selected.isNotEmpty()) item { Button(enabled = enabled && status?.optBoolean("truncated") != true, onClick = { editingCommit = true }) { Text("Prepare commit · ${selected.size} paths") } }
    }
    if (editingCommit) AlertDialog(onDismissRequest = { if (!busy) editingCommit = false }, title = { Text("Prepare local commit") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${selected.size} selected paths. Author details become part of repository history.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(message, { message = it.take(500) }, label = { Text("Commit message · one line") }, enabled = enabled, singleLine = true)
            OutlinedTextField(authorName, { authorName = it.take(100) }, label = { Text("Author name") }, enabled = enabled, singleLine = true)
            OutlinedTextField(authorEmail, { authorEmail = it.take(254) }, label = { Text("Author email") }, enabled = enabled, singleLine = true)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = { TextButton(enabled = enabled && GithubDraftPolicy.message(message) && GithubDraftPolicy.author(authorName, authorEmail), onClick = { operate("$base/commit/prepare", JSONObject().put("paths", JSONArray(selected.sorted())).put("message", message.trim()).put("authorName", authorName.trim()).put("authorEmail", authorEmail.trim()), "commit_preview") }) { Text("Review exact commit") } }, dismissButton = { TextButton(enabled = !busy, onClick = { editingCommit = false }) { Text("Cancel") } })
    preview?.let { prepared ->
        val push = previewKind == "push_preview"
        AlertDialog(onDismissRequest = { if (!busy) preview = null }, title = { Text(if (push) "Review GitHub push" else "Review local commit") }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Branch: ${prepared.optString("branch")}\nHEAD: ${prepared.optString("head")}\nExpires: ${prepared.optString("expiresAt")}", style = MaterialTheme.typography.bodySmall)
                if (push) Text("Repository: ${prepared.optString("repository")}\nAccount: ${prepared.optString("accountLabel")}\nRemote HEAD: ${if (prepared.isNull("remoteHead")) "New branch" else prepared.optString("remoteHead").ifBlank { "New branch" }}\nRequest approval on your PC to proceed. The phone cannot approve this push.")
                else {
                    Text("${prepared.optString("authorName")} <${prepared.optString("authorEmail")}>\n${prepared.optString("message")}")
                    Text("Selected changes", style = MaterialTheme.typography.titleSmall)
                    GitFileReview(prepared.objects("files"))
                }
                if (prepared.optString("disclosure").isNotBlank()) Text(prepared.optString("disclosure"))
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = { TextButton(enabled = !busy && prepared.optString("id").isNotBlank(), onClick = { operate("$base/${if (push) "push" else "commit"}", JSONObject().put("previewId", prepared.optString("id")), if (push) "push" else "commit") }) { Text(if (push) "Request PC approval" else "Create local commit") } }, dismissButton = { TextButton(enabled = !busy, onClick = { preview = null }) { Text("Cancel review") } })
    }
}

/** Full reviewed text is available in bounded lazy chunks, including long single-line files. */
@Composable private fun GitFileReview(files: List<JSONObject>) {
    var index by remember(files.firstOrNull()?.optString("path")) { mutableIntStateOf(0) }
    var side by remember { mutableStateOf("after") }
    val file = files.getOrNull(index.coerceIn(0, (files.size - 1).coerceAtLeast(0))) ?: return
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${file.optString("path")}\n${file.optString("kind")} · ${file.optLong("bytes")} bytes", style = MaterialTheme.typography.bodySmall)
        if (files.size > 1) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(enabled = index > 0, onClick = { index-- }) { Text("Previous file") }
            Text("${index + 1}/${files.size}", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelSmall)
            TextButton(enabled = index < files.lastIndex, onClick = { index++ }) { Text("Next file") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("before", "after").forEach { value -> FilterChip(selected = side == value, onClick = { side = value }, label = { Text(value.replaceFirstChar(Char::uppercaseChar)) }) } }
        val content = file.optString(side)
        if (file.isNull(side)) Text("File absent on this side.", style = MaterialTheme.typography.bodySmall)
        else if (content.isEmpty()) Text("Empty file.", style = MaterialTheme.typography.bodySmall)
        else {
            val chunks = remember(content) { content.chunked(1500) }
            SelectionContainer {
                LazyColumn(Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 280.dp)) {
                    items(chunks.size, key = { "$index-$side-$it" }) { part -> Text(chunks[part], fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
                }
            }
        }
    }
}
