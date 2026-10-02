package dev.nakama.companion

import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

object SkillDraftPolicy {
    fun steps(text: String) = text.lines().map(String::trim).filter(String::isNotEmpty)
    fun tags(text: String) = text.split(',').map(String::trim).filter(String::isNotEmpty).distinct()
    fun valid(title: String, description: String, whenToUse: String, steps: String, tags: String): Boolean =
        title.trim().length in 1..80 && description.trim().length <= 500 && whenToUse.trim().length in 1..500 &&
        steps(steps).size in 1..12 && steps(steps).all { it.length <= 500 } && tags(tags).size <= 8 && tags(tags).all { it.length <= 40 }
}

@Composable
fun SkillsPanel(identityKey: String?, allowed: Boolean, snapshot: JSONObject?, request: suspend (String, String, JSONObject?) -> JSONObject, refresh: suspend () -> Unit) {
    val scope = rememberCoroutineScope()
    val motion = LocalNakamaMotion.current
    val currentAllowed by rememberUpdatedState(allowed)
    val currentIdentity by rememberUpdatedState(identityKey)
    var library by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var edit by remember { mutableStateOf<JSONObject?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var generation by remember { mutableLongStateOf(0L) }
    fun valid(expected: String?, token: Long) = currentAllowed && currentIdentity == expected && generation == token
    suspend fun load(expected: String?, token: Long) {
        val result = request("GET", "/api/skills", null)
        if (valid(expected, token)) { check(result.optInt("version") == 1) { "Update Control Center to use this skills library." }; library = result }
    }
    LaunchedEffect(identityKey, allowed) {
        val token = ++generation; library = null; edit = null; selectedId = null; error = ""; busy = false
        if (allowed && identityKey != null) {
            if (snapshot?.optInt("version") == 1) library = snapshot
            busy = true
            try { load(identityKey, token) } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (valid(identityKey, token)) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        }
    }
    LaunchedEffect(snapshot) { if (allowed && !busy && snapshot?.optInt("version") == 1) library = snapshot }
    fun mutate(method: String, path: String, body: JSONObject? = null) {
        if (!allowed || identityKey == null || busy) return
        val expected = identityKey; val token = generation; busy = true; error = ""
        scope.launch {
            try {
                request(method, path, body)
                if (valid(expected, token)) { edit = null; selectedId = null; load(expected, token); refresh() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (valid(expected, token)) error = failure.message.orEmpty() }
            finally { if (token == generation) busy = false }
        }
    }
    if (!allowed || identityKey == null) { Text("Connect your paired PC and enable Google and project access to see Skills."); return }
    val skills = library?.objects("skills").orEmpty()
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text("Learned skills", style = MaterialTheme.typography.headlineSmall); Text("Reusable instructions for future work. Review learned candidates before enabling reuse. Skills do not grant permissions or execute code.", style = MaterialTheme.typography.bodySmall) }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { edit = JSONObject() }, enabled = !busy && library != null && skills.size < 50) { Text("Teach a skill") }
            TextButton(enabled = !busy, onClick = {
                val expected = identityKey; val token = generation; busy = true; error = ""
                scope.launch { try { load(expected, token) } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (valid(expected, token)) error = failure.message.orEmpty() } finally { if (token == generation) busy = false } }
            }) { Text("Refresh skills") }
        } }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        library?.let { data ->
            item { SkillToggle("Learn from reviewed projects", data.optBoolean("learningEnabled"), !busy) { mutate("PATCH", "/api/skills/settings", JSONObject().put("learningEnabled", it)) } }
            item { SkillToggle("Reuse approved skills", data.optBoolean("reuseEnabled"), !busy) { mutate("PATCH", "/api/skills/settings", JSONObject().put("reuseEnabled", it)) }; Text("The PC's overall memory setting must also be on for automatic learning and reuse.", style = MaterialTheme.typography.bodySmall) }
        }
        if (library != null && skills.isEmpty()) item { Text("No skills yet. Teach a repeatable method or review a candidate after a completed project.") }
        items(skills, key = { it.optString("id") }) { skill ->
            Surface(modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = tween(MotionPolicy.duration(motion, 220))).fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(skill.optString("title"), style = MaterialTheme.typography.titleMedium)
                    MotionStatus(if (skill.optString("status") == "candidate") "candidate" else if (skill.optBoolean("enabled")) "ready" else "paused")
                    Text(skill.optString("description"), style = MaterialTheme.typography.bodySmall)
                    Text("Selected for ${skill.optInt("useCount")} tasks · ${skill.optJSONObject("source")?.optString("kind").orEmpty().replace('_', ' ')}", style = MaterialTheme.typography.labelSmall)
                    TextButton(enabled = !busy, onClick = { selectedId = skill.optString("id") }) { Text("Review ${skill.optString("title")}") }
                }
            }
        }
    }
    skills.firstOrNull { it.optString("id") == selectedId }?.let { skill ->
        val id = skill.optString("id"); val candidate = skill.optString("status") == "candidate"
        AlertDialog(onDismissRequest = { if (!busy) selectedId = null }, title = { Text(skill.optString("title")) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Use when: ${skill.optString("whenToUse")}")
                val steps = skill.optJSONArray("steps") ?: JSONArray()
                repeat(steps.length()) { Text("${it + 1}. ${steps.optString(it)}") }
                val source = skill.optJSONObject("source")
                Text("Source: ${source?.optString("kind").orEmpty().replace('_', ' ')}\n${source?.optString("detail").orEmpty()}", style = MaterialTheme.typography.bodySmall)
                if (!source?.optString("workflowId").isNullOrBlank()) Text("Reviewed workflow: ${source?.optString("workflowId")}", style = MaterialTheme.typography.labelSmall)
                Text("Last selected: ${skill.optString("lastUsedAt").ifBlank { "Never recorded" }}", style = MaterialTheme.typography.bodySmall)
                Text("Selection receipts show matching context, not proof that a model followed the skill. Changed or disabled skills can be withheld before a task starts.", style = MaterialTheme.typography.bodySmall)
                library?.objects("receipts").orEmpty().filter { receipt -> receipt.optJSONArray("skillIds")?.let { ids -> (0 until ids.length()).any { ids.optString(it) == id } } == true }.takeLast(3).forEach { receipt ->
                    Text("Task ${receipt.optString("taskId")} · ${receipt.optString("role")}\n${receipt.optString("createdAt")}", style = MaterialTheme.typography.labelSmall)
                }
                if (candidate) Text("This candidate is not reused until you accept it.")
                else SkillToggle("Enabled for reuse", skill.optBoolean("enabled"), !busy) { mutate("PATCH", "/api/skills/$id", JSONObject().put("enabled", it)) }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(enabled = !busy, onClick = { selectedId = null; edit = skill }) { Text("Edit skill") }
                TextButton(enabled = !busy, onClick = { mutate("DELETE", "/api/skills/$id") }) { Text("Forget skill") }
            }
        }, confirmButton = { if (candidate) TextButton(enabled = !busy, onClick = { mutate("POST", "/api/skills/$id/accept", JSONObject()) }) { Text("Accept for reuse") } else TextButton(enabled = !busy, onClick = { selectedId = null }) { Text("Done") } }, dismissButton = { if (candidate) TextButton(enabled = !busy, onClick = { selectedId = null }) { Text("Close") } })
    }
    edit?.let { skill ->
        var title by remember(skill) { mutableStateOf(skill.optString("title")) }
        var description by remember(skill) { mutableStateOf(skill.optString("description")) }
        var whenToUse by remember(skill) { mutableStateOf(skill.optString("whenToUse")) }
        var steps by remember(skill) { mutableStateOf(skill.optJSONArray("steps")?.let { array -> (0 until array.length()).joinToString("\n") { array.optString(it) } }.orEmpty()) }
        var tags by remember(skill) { mutableStateOf(skill.optJSONArray("tags")?.let { array -> (0 until array.length()).joinToString(", ") { array.optString(it) } }.orEmpty()) }
        AlertDialog(onDismissRequest = { if (!busy) edit = null }, title = { Text(if (skill.optString("id").isBlank()) "Teach a skill" else "Edit skill") }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Save instructions, never passwords or tokens. Up to 12 steps, one per line, 500 characters each.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(title, { title = it.take(80) }, label = { Text("Skill title") }, enabled = !busy)
                OutlinedTextField(description, { description = it.take(500) }, label = { Text("Description") }, enabled = !busy)
                OutlinedTextField(whenToUse, { whenToUse = it.take(500) }, label = { Text("When to use") }, enabled = !busy)
                OutlinedTextField(steps, { steps = it.take(6011) }, label = { Text("Steps · one per line") }, minLines = 3, enabled = !busy)
                OutlinedTextField(tags, { tags = it.take(334) }, label = { Text("Tags · comma separated") }, enabled = !busy)
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        }, confirmButton = { TextButton(enabled = !busy && SkillDraftPolicy.valid(title, description, whenToUse, steps, tags), onClick = {
            val id = skill.optString("id")
            mutate(if (id.isBlank()) "POST" else "PATCH", "/api/skills" + if (id.isBlank()) "" else "/$id", JSONObject().put("title", title.trim()).put("description", description.trim()).put("whenToUse", whenToUse.trim()).put("steps", JSONArray(SkillDraftPolicy.steps(steps))).put("tags", JSONArray(SkillDraftPolicy.tags(tags))))
        }) { Text("Save skill") } }, dismissButton = { TextButton(enabled = !busy, onClick = { edit = null }) { Text("Cancel") } })
    }
}

@Composable private fun SkillToggle(label: String, value: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium); Switch(value, change, enabled = enabled) }
}
