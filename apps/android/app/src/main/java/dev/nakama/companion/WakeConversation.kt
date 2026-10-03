package dev.nakama.companion

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.ZoneId
import java.util.UUID

/** A wake utterance uses the existing device-scoped host route, exactly once. No provider is called locally. */
internal class WakeConversation(
    private val deviceId: String,
    private val request: suspend (String, String, JSONObject?) -> JSONObject,
    private val current: () -> Boolean,
    private val speak: suspend (String) -> Unit,
    private val needsForeground: () -> Unit,
    private val observe: suspend (JSONObject) -> Unit = {},
    private val pause: suspend (Long) -> Unit = { delay(it) },
    private val receiptFeedback: suspend (JSONObject, JSONObject) -> String? = { _, _ -> null },
) {
    private suspend fun snapshot(): JSONObject {
        check(current()) { "Wake conversation stopped. Open Nakama to continue." }
        val snapshot = request("GET", "/api/state", null)
        check(current()) { "The pairing or wake session changed." }
        check(WakeConversationAccess.allowed(snapshot, deviceId)) { "Connect your PC and enable this phone's access before asking Nakama." }
        observe(snapshot)
        return snapshot
    }
    private suspend fun receipts(state: JSONObject, taskIds: Collection<String>, workflowId: String): JSONObject {
        if (taskIds.isEmpty() && workflowId.isBlank()) return state
        check(current()) { "The wake session changed before checking accepted replies." }
        val result = request("POST", "/api/chats/receipts", JSONObject()
            .put("taskIds", org.json.JSONArray(taskIds.take(50)))
            .put("workflowIds", org.json.JSONArray(listOf(workflowId).filter { it.isNotBlank() })))
        val fresh = snapshot() // Permissions and pairing may change during archive retrieval.
        val merged = (fresh.objects("messages") + result.objects("messages")).distinctBy { it.optString("id") }.filter { DeviceDelivery.addressedTo(it, deviceId) }
        return JSONObject(fresh.toString()).put("messages", org.json.JSONArray(merged))
    }
    suspend fun run(command: String) {
        snapshot()
        check(current()) { "The wake session ended before submission." }
        val body = JSONObject().put("message", command.take(24_000)).put("routing", "auto")
            .put("inputMode", "voice").put("timeZone", ZoneId.systemDefault().id).put("requestId", UUID.randomUUID().toString())
        // Never retry this POST: a lost response may already have started work on the host.
        val response = request("POST", "/api/chat", body)
        follow(response)
    }
    /** Continue an already accepted foreground request; this path never submits another POST. */
    suspend fun follow(response: JSONObject) {
        var state = snapshot() // Recheck current access before speaking even an immediate receipt.
        if (!DeviceDelivery.addressedTo(response, deviceId)) return
        val taskIds = response.optJSONArray("taskIds")?.let { values -> (0 until values.length()).map { values.optString(it) }.filter { it.isNotBlank() }.toMutableSet() } ?: mutableSetOf()
        val workflowId = response.optString("workflowId")
        var workflowPending = workflowId.isNotBlank()
        val spokenMessages = response.optJSONArray("spokenMessageIds")?.let { values -> (0 until values.length()).map { values.optString(it) }.toMutableSet() } ?: mutableSetOf()
        val feedback = receiptFeedback(response, state)
        check(current()) { "The wake session changed before reply playback." }
        listOfNotNull(response.optString("reply").takeIf { it.isNotBlank() }, feedback).joinToString(" ").takeIf { it.isNotBlank() }?.let { speak(it) }
        if (response.optJSONObject("outcome")?.optString("type") == "navigate" || response.optString("intakeId").isNotBlank()) needsForeground()
        repeat(180) { attempt ->
            check(current()) { "The wake session ended." }
            val projectAllowed = state.objects("devices").firstOrNull { it.optString("id") == deviceId }?.optJSONObject("permissions")?.opt("projectAccess") != false
            if (workflowPending && !projectAllowed) throw IllegalStateException("Project access changed. Open Nakama to review your permissions.")
            state = receipts(state, taskIds, if (workflowPending) workflowId else "")
            val messages = state.objects("messages").filter { it.optString("role") == "assistant" && DeviceDelivery.addressedTo(it, deviceId) }
            val workflow = state.objects("projectWorkflows").firstOrNull { it.optString("id") == workflowId && DeviceDelivery.addressedTo(it, deviceId) }
            val latestQuestion = messages.lastOrNull { it.optString("workflowId") == workflowId && it.optString("kind") == "project_questions" }
            val replies = messages.filter { message ->
                message.opt("pipelineIntermediate") != true && message.optString("id") !in spokenMessages &&
                    (message.optString("taskId") in taskIds || (workflowPending && message.optString("workflowId") == workflowId &&
                        (message.optString("kind") == "project_delivery" || (message === latestQuestion && workflow?.optString("status") == "awaiting_answers"))))
            }
            for (reply in replies) {
                state = receipts(snapshot(), taskIds, if (workflowPending) workflowId else "")
                check(WakeConversationAccess.allowed(state, deviceId)) { "Access changed before reply playback." }
                val freshReply = state.objects("messages").firstOrNull { it.optString("role") == "assistant" && DeviceDelivery.addressedTo(it, deviceId) && it.optString("id") == reply.optString("id") }
                freshReply?.optString("content")?.takeIf { it.isNotBlank() }?.let { speak(it) }
                spokenMessages += reply.optString("id")
                taskIds.remove(reply.optString("taskId"))
                if (reply.optString("kind") == "project_questions") { needsForeground(); workflowPending = false }
            }
            state.objects("tasks").filter { DeviceDelivery.addressedTo(it, deviceId) && it.optString("id") in taskIds && ReplyPolling.finished(it.optString("status")) }.forEach { task ->
                taskIds.remove(task.optString("id"))
                if (ReplyPolling.unsuccessful(task.optString("status"))) speak(task.optString("error").ifBlank { "That task stopped. Open Nakama to review its status." })
            }
            if (workflowPending && workflow?.optString("status") == "awaiting_answers" && latestQuestion?.optString("id") in spokenMessages) workflowPending = false
            if (workflowPending && workflow?.optString("status") in listOf("completed", "failed", "stopped", "interrupted", "needs_attention", "awaiting_answers")) {
                if (workflow?.optString("status") != "completed") { needsForeground(); if (replies.isEmpty()) speak("Your project needs attention. Open Nakama to review its current question or status.") }
                workflowPending = false
            }
            if (taskIds.isEmpty() && !workflowPending) return
            pause(if (attempt < 30) 1_000 else 3_000)
            state = snapshot()
        }
        needsForeground()
        speak("Your request is still running. Open Nakama to follow its progress. I will not submit it again.")
    }
}

internal object WakeConversationAccess {
    fun allowed(snapshot: JSONObject, deviceId: String): Boolean {
        val device = snapshot.objects("devices").firstOrNull { it.optString("id") == deviceId } ?: return false
        val permissions = device.optJSONObject("permissions") ?: return false
        return permissions.opt("googleAccess") != false && permissions.opt("projectAccess") != false
    }
}
