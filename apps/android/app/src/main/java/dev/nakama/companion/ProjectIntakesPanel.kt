package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ProjectIntakesPanel(state: JSONObject, allowed: Boolean, request: suspend (String, String, JSONObject?) -> JSONObject, refresh: suspend () -> Unit, selectedId: String?, dictation: QuestionDictation?, onVoice: (String, String) -> Unit, openWorkflow: (String, String) -> Unit) {
    val scope = rememberCoroutineScope(); val currentAllowed by rememberUpdatedState(allowed)
    var prompt by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var focus by remember(selectedId) { mutableStateOf(selectedId) }
    fun send(route: String, body: JSONObject) {
        if (!allowed || busy) return
        busy = true; error = ""
        scope.launch { try {
            val result = request("POST", route, body)
            if (currentAllowed) { if (route == "/api/project-intakes") { focus = result.optString("intakeId"); prompt = "" }; refresh() }
        } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (currentAllowed) error = failure.message.orEmpty() } finally { busy = false } }
    }
    if (!allowed) { Text("Connect your paired PC and enable Google and project access to answer project setup questions."); return }
    val deliveries = state.objects("projectDeliveries")
    val intakes = (state.objects("projectIntakes") + deliveries).filter { focus == null || it.optString("id") == focus }.sortedByDescending { it.optString("updatedAt") }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text("Project setup and delivery", style = MaterialTheme.typography.headlineSmall); Text("Resolve questions before planning or delivery. These answers do not authorise accounts, purchases or deployment; protected actions still need PC approval.", style = MaterialTheme.typography.bodySmall) }
        if (focus != null) item { TextButton(onClick = { focus = null }) { Text("Show all project setups") } }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (focus == null) item {
            OutlinedTextField(prompt, { prompt = it.take(12000) }, Modifier.fillMaxWidth(), label = { Text("Describe the new project") }, enabled = !busy, minLines = 2)
            Button(enabled = !busy && prompt.isNotBlank(), onClick = { send("/api/project-intakes", JSONObject().put("message", prompt.trim())) }) { Text("Prepare setup questions") }
        }
        if (intakes.isEmpty()) item { Text(if (focus == null) "No project setups yet. Describe a project here or in Chat." else "This setup is no longer in your permitted snapshot.") }
        items(intakes, key = { it.optString("id") }) { intake ->
            val id = intake.optString("id"); val status = intake.optString("status"); val questions = intake.objects("questions")
            val delivery = deliveries.any { it.optString("id") == id }
            val answers = remember(id) { mutableStateMapOf<String, String>() }
            var projectName by remember(id) { mutableStateOf("") }
            LaunchedEffect(dictation?.sequence) { if (dictation?.workflowId == id && questions.any { it.optString("id") == dictation.questionId }) answers[dictation!!.questionId] = dictation.text.take(6000) }
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) { Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (delivery) intake.optString("summary").ifBlank { "Delivery manager questions" } else intake.optString("message"), style = MaterialTheme.typography.titleMedium); MotionStatus(status)
                questions.forEach { question ->
                    val questionId = question.optString("id"); Text(question.optString("question"))
                    if (status == "awaiting_answers" && (!delivery || question.optString("answer").isBlank())) {
                        OutlinedTextField(answers[questionId] ?: question.optString("answer"), { answers[questionId] = it.take(6000) }, Modifier.fillMaxWidth(), label = { Text("Setup answer") }, enabled = !busy, minLines = 2)
                        TextButton(enabled = !busy, onClick = { onVoice(id, questionId) }) { Text("Answer setup question by voice") }
                    } else Text(question.optString("answer"), style = MaterialTheme.typography.bodySmall)
                }
                if (status == "awaiting_answers") Button(enabled = !busy && answers.values.any(String::isNotBlank), onClick = {
                    val pending = answers.filter { (key, value) -> value.isNotBlank() && (!delivery || questions.any { it.optString("id") == key && it.optString("answer").isBlank() }) }
                    send(if (delivery) "/api/project-deliveries/$id/answers" else "/api/project-intakes/$id/answers", JSONObject().apply { if (!delivery) put("revision", intake.optInt("revision")) }.put("answers", JSONArray(pending.map { (key, value) -> JSONObject().put("id", key).put("answer", value.trim()) })))
                }) { Text("Save setup answers") }
                if (!delivery && status == "ready") {
                    val projectId = intake.optString("projectId").takeUnless { it == "null" }.orEmpty()
                    if (projectId.isBlank()) OutlinedTextField(projectName, { projectName = it.take(80) }, Modifier.fillMaxWidth(), label = { Text("New local project name") }, enabled = !busy, singleLine = true)
                    Button(enabled = !busy && (projectId.isNotBlank() || projectName.isNotBlank()), onClick = { send("/api/project-intakes/$id/start", JSONObject().put("revision", intake.optInt("revision")).apply { if (projectId.isNotBlank()) put("projectId", projectId) else put("name", projectName.trim()) }) }) { Text("Start managed planning") }
                }
                if (!delivery && status in listOf("ready", "awaiting_answers")) TextButton(enabled = !busy, onClick = { send("/api/project-intakes/$id/cancel", JSONObject()) }) { Text("Cancel setup") }
                if (intake.optString("workflowId").isNotBlank()) TextButton(onClick = { openWorkflow(intake.optString("workflowId"), intake.optString("projectId")) }) { Text("Open managed project") }
            } }
        }
    }
}
