package dev.nakama.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WakeConversationTest {
    private fun state(allowed: Boolean = true, messages: String = "[]", tasks: String = "[]") = JSONObject("""{"devices":[{"id":"fixture-phone","permissions":{"googleAccess":$allowed,"projectAccess":true}}],"messages":$messages,"tasks":$tasks}""").apply { listOf("messages", "tasks").forEach { key -> objects(key).forEach { if (!it.has("deliveryDeviceId")) it.put("deliveryDeviceId", "fixture-phone") } } }
    @Test fun backgroundRequestSubmitsOnceAndSpeaksOnlyItsReceiptBoundAnswer() = runBlocking {
        val spoken = mutableListOf<String>(); var posts = 0; var reads = 0
        val runner = WakeConversation("fixture-phone", { method, path, body ->
            if (method == "POST") {
                assertEquals("/api/chat", path); assertEquals("auto", body!!.getString("routing")); assertFalse(body.has("providerId")); posts++
                JSONObject("""{"deliveryDeviceId":"fixture-phone","taskIds":["own-task"],"reply":"Working on your recipe"}""")
            } else {
                reads++
                state(messages = if (reads < 3) "[]" else """[{"id":"other-message","role":"assistant","taskId":"other-task","content":"PRIVATE OTHER REQUEST"},{"id":"mine","role":"assistant","taskId":"own-task","content":"Boil the water first."}]""")
            }
        }, { true }, { spoken += it }, { fail("No foreground handoff needed for an ordinary answer") }, pause = {})
        runner.run("Give me a recipe")
        assertEquals(1, posts); assertEquals(listOf("Working on your recipe", "Boil the water first."), spoken)
    }
    @Test fun acceptedForegroundReceiptContinuesWithoutSubmittingAgain() = runBlocking {
        val spoken = mutableListOf<String>(); val methods = mutableListOf<String>()
        WakeConversation("fixture-phone", { method, _, _ ->
            methods += method
            state(messages = """[{"id":"reply","role":"assistant","taskId":"accepted","content":"Your existing request is finished."}]""")
        }, { true }, { spoken += it }, {}, pause = {}).follow(JSONObject("""{"deliveryDeviceId":"fixture-phone","taskIds":["accepted"]}"""))
        assertTrue(methods.all { it == "GET" }); assertEquals(listOf("Your existing request is finished."), spoken)
    }
    @Test fun revokedAccessAfterSubmissionSuppressesImmediateAndDelayedSpeech() = runBlocking {
        var posted = false; val spoken = mutableListOf<String>()
        val runner = WakeConversation("fixture-phone", { method, _, _ ->
            if (method == "POST") { posted = true; JSONObject("""{"deliveryDeviceId":"fixture-phone","reply":"PRIVATE RESPONSE","taskIds":["a"]}""") }
            else state(allowed = !posted)
        }, { true }, { spoken += it }, {}, pause = {})
        try { runner.run("fixture"); fail("Revoked access must stop the response") } catch (_: IllegalStateException) { }
        assertTrue(posted); assertTrue(spoken.isEmpty())
    }
    @Test fun accessIsCheckedAgainBetweenTwoQueuedReplies() = runBlocking {
        var allowed = true; val spoken = mutableListOf<String>()
        val messages = """[{"id":"one","role":"assistant","taskId":"a","content":"First answer"},{"id":"two","role":"assistant","taskId":"b","content":"MUST NOT BE SPOKEN"}]"""
        val runner = WakeConversation("fixture-phone", { _, _, _ -> state(allowed, messages) }, { true }, { spoken += it; allowed = false }, {}, pause = {})
        try { runner.follow(JSONObject("""{"deliveryDeviceId":"fixture-phone","taskIds":["a","b"]}""")); fail("Access removal must stop the second reply") } catch (_: IllegalStateException) { }
        assertEquals(listOf("First answer"), spoken)
    }
    @Test fun uncertainPostIsNeverRetriedAndStoppedSessionCannotSubmit() = runBlocking {
        var posts = 0
        val runner = WakeConversation("fixture-phone", { method, _, _ -> if (method == "POST") { posts++; throw IllegalStateException("Lost response") } else state() }, { true }, { fail("No speech after uncertain request") }, {}, pause = {})
        try { runner.run("fixture"); fail("Expected uncertain transport") } catch (_: IllegalStateException) { }
        assertEquals(1, posts)
        val stopped = WakeConversation("fixture-phone", { _, _, _ -> fail("Stopped request must not access host"); state() }, { false }, {}, {}, pause = {})
        try { stopped.run("fixture"); fail("Stopped session must fail") } catch (_: IllegalStateException) { }
    }
    @Test fun hostRepliesNeedAnExactDeviceAndBothSharedPermissions() {
        assertFalse(WakeConversationAccess.allowed(JSONObject(), "fixture-phone"))
        assertFalse(WakeConversationAccess.allowed(state(), "other-phone"))
        val restricted = state().apply { getJSONArray("devices").getJSONObject(0).getJSONObject("permissions").put("projectAccess", false) }
        assertFalse(WakeConversationAccess.allowed(restricted, "fixture-phone"))
    }
    @Test fun foregroundQuestionAlreadySpokenIsNotReplayedByReceiptHandoff() = runBlocking {
        val snapshot = state(messages = """[{"id":"question","role":"assistant","workflowId":"workflow","kind":"project_questions","content":"ALREADY SPOKEN"}]""").put("projectWorkflows", org.json.JSONArray("""[{"id":"workflow","deliveryDeviceId":"fixture-phone","status":"awaiting_answers"}]"""))
        val spoken = mutableListOf<String>()
        WakeConversation("fixture-phone", { method, _, _ -> assertEquals("GET", method); snapshot }, { true }, { spoken += it }, {}, pause = {})
            .follow(JSONObject("""{"deliveryDeviceId":"fixture-phone","workflowId":"workflow","spokenMessageIds":["question"]}"""))
        assertTrue(spoken.isEmpty())
    }

    @Test fun projectAccessRevocationSuppressesOrdinaryChatReceiptsAsWellAsProjects() = runBlocking {
        var posted = false; val spoken = mutableListOf<String>()
        val runner = WakeConversation("fixture-phone", { method, _, _ ->
            if (method == "POST") { posted = true; JSONObject("""{"deliveryDeviceId":"fixture-phone","reply":"MUST STAY PRIVATE","taskIds":["ordinary-chat"]}""") }
            else state().apply { if (posted) getJSONArray("devices").getJSONObject(0).getJSONObject("permissions").put("projectAccess", false) }
        }, { true }, { spoken += it }, {}, pause = {})
        try { runner.run("An ordinary conversation"); fail("Shared access removal must stop ordinary speech") } catch (_: IllegalStateException) { }
        assertTrue(posted); assertTrue(spoken.isEmpty())
    }

}
