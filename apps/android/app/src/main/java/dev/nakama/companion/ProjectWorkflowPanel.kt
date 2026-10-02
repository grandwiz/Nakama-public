package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ProjectWorkflowPanel(workflow: JSONObject, canRespond: Boolean, busy: Boolean, onAnswers: (JSONObject) -> Unit, onStop: () -> Unit, canStop: Boolean = canRespond, dictation: QuestionDictation? = null, onVoiceAnswer: ((String) -> Unit)? = null) {
    val id = workflow.optString("id")
    val status = workflow.optString("status")
    val questions = workflow.objects("questions").filter { it.optString("answer").isBlank() }
    val questionKey = questions.joinToString("|") { it.optString("id") }
    val answers = remember(id, questionKey) { mutableStateMapOf<String, String>() }
    LaunchedEffect(dictation?.sequence) { if (canRespond && dictation?.workflowId == id && questions.any { it.optString("id") == dictation.questionId }) answers[dictation!!.questionId] = dictation.text.take(6000) }
    var showPlan by remember(id) { mutableStateOf(false) }
    var showChecks by remember(id) { mutableStateOf(false) }
    val checks = workflow.objects("checkReceipts")
    val dependencyApproval = checks.any { it.optString("approvalId") == workflow.optString("checkApprovalId") && it.optString("checkName") == "dependencies" }
    val stage = when (if (status in listOf("completed", "needs_attention", "stopped", "cancelled", "interrupted", "failed")) status else workflow.optString("stage")) {
        "planning" -> "Your planners are preparing the project"
        "manager_planning" -> "Your manager is completing the plan"
        "awaiting_answers" -> "Your manager has questions"
        "developing" -> "Your development workers are completing the agreed tasks"
        "awaiting_check_approval" -> if (dependencyApproval) "Dependency preparation needs your PC approval" else "Project check needs your PC approval"
        "checking" -> if (dependencyApproval) "Preparing locked dependencies" else "Running project checks"
        "reviewing" -> "Your two reviewers are checking the work"
        "fixing" -> "Your development workers are making the requested fixes"
        "delivering" -> "Your manager is preparing the handover"
        "completed" -> "Project handover ready"
        "needs_attention" -> "Project work needs attention"
        "stopped", "cancelled" -> "Project workflow stopped"
        "interrupted" -> "Project workflow interrupted"
        "failed" -> "Project workflow could not continue"
        else -> "Project workflow"
    }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stage, style = MaterialTheme.typography.titleMedium)
            Text("${status.replace('_', ' ')} · Review round ${workflow.optInt("reviewRound", 0)}", style = MaterialTheme.typography.labelSmall)
            if (workflow.optString("detail").isNotBlank()) Text(workflow.optString("detail"), style = MaterialTheme.typography.bodySmall)
            if (workflow.optString("error").isNotBlank()) Text(workflow.optString("error"))
            if (status == "running" && workflow.optString("stage") == "awaiting_check_approval") Text(if (dependencyApproval) "Open Activity & approvals on your PC to review the exact npm ci command and package/lockfile hashes. It downloads public npm packages and replaces this project's node_modules. Lifecycle scripts are disabled; packages needing install scripts may still need setup. Each installation needs fresh PC approval. This phone cannot approve it." else "Open Activity & approvals on your PC to review the exact command and scripts. Every check run needs fresh PC approval, including runs after a repair. This phone cannot approve it.")
            if (status == "awaiting_answers") {
                Text(if (canRespond) "Answer your manager here. Development waits until every question is answered." else "Reconnect and enable project access to answer these questions, or use your PC.")
                questions.forEach { question ->
                    val questionId = question.optString("id")
                    Text(question.optString("text"))
                    if (canRespond) OutlinedTextField(answers[questionId].orEmpty(), { answers[questionId] = it.take(6000) }, label = { Text("Your answer") }, modifier = Modifier.fillMaxWidth(), enabled = !busy, minLines = 2)
                    if (canRespond && onVoiceAnswer != null) TextButton(enabled = !busy, onClick = { onVoiceAnswer(questionId) }) { Text("Answer this question by voice") }
                }
                if (canRespond) Button(enabled = !busy && questions.isNotEmpty() && questions.all { answers[it.optString("id")].orEmpty().isNotBlank() }, onClick = {
                    onAnswers(JSONObject().put("answers", JSONArray(questions.map { JSONObject().put("id", it.optString("id")).put("answer", answers[it.optString("id")].orEmpty().trim()) })))
                }) { Text("Send answers to manager") }
            }
            val plan = workflow.optString("plan")
            if (workflow.optString("checkSummary").isNotBlank()) Text(workflow.optString("checkSummary"), style = MaterialTheme.typography.bodySmall)
            if (checks.isNotEmpty()) {
                TextButton(onClick = { showChecks = !showChecks }) { Text(if (showChecks) "Hide project check results" else "Read project check results (${checks.size})") }
                if (showChecks) checks.forEach { check ->
                    val exit = if (check.has("exitCode") && !check.isNull("exitCode")) " · exit ${check.optInt("exitCode")}" else ""
                    val signal = if (check.optString("signal").isNotBlank() && !check.isNull("signal")) " · signal ${check.optString("signal")}" else ""
                    val dependency = check.optString("checkName") == "dependencies"
                    Text("${if (dependency) "Locked dependencies (npm ci)" else check.optString("checkName")} · round ${check.optInt("round")} · ${check.optString("status").replace('_', ' ')}$exit$signal", style = MaterialTheme.typography.bodySmall)
                    if (check.optString("status") == "awaiting_approval") Text(if (dependency) "Dependency preparation has not started." else "This check has not started.", style = MaterialTheme.typography.bodySmall)
                    if (dependency) Text("Approved npm ci replaces node_modules with the exact locked public packages. Lifecycle scripts are disabled. This receipt does not establish a passing build or working website.", style = MaterialTheme.typography.bodySmall)
                    if (check.optString("error").isNotBlank()) Text(check.optString("error"), style = MaterialTheme.typography.bodySmall)
                }
            }
            if (plan.isNotBlank()) {
                TextButton(onClick = { showPlan = !showPlan }) { Text(if (showPlan) "Hide project plan" else "Read project plan") }
                if (showPlan) Text(plan, style = MaterialTheme.typography.bodySmall)
            }
            if (canStop && status in listOf("running", "awaiting_answers")) OutlinedButton(enabled = !busy, onClick = onStop) { Text("Stop project workflow") }
        }
    }
}
