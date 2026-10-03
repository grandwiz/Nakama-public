package dev.nakama.companion

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceIsolationTest {
    private fun state(messages: JSONArray = JSONArray()) = JSONObject().put("devices", JSONArray().put(
        JSONObject().put("id", "phone").put("permissions", JSONObject().put("googleAccess", true).put("projectAccess", true))
    )).put("messages", messages)
    @Test fun acceptedTaskIdDoesNotAuthorizeAnotherDevicesMessage() = runBlocking {
        val spoken = mutableListOf<String>(); var reads = 0
        fun message(id: String, recipient: String, text: String) = JSONObject().put("id", id).put("role", "assistant").put("taskId", "same-task").put("deliveryDeviceId", recipient).put("content", text)
        WakeConversation("phone", { method, path, body ->
            if (path == "/api/chats/receipts") {
                assertEquals("POST", method)
                assertEquals("same-task", body!!.getJSONArray("taskIds").getString(0))
                JSONObject().put("messages", JSONArray())
            } else {
                assertEquals("GET", method); assertEquals("/api/state", path); reads++
                state(JSONArray().put(message("other", "tablet", "FOREIGN MUST STAY SILENT")).apply {
                    if (reads > 1) put(message("mine", "phone", "Only this phone's answer"))
                })
            }
        }, { true }, { spoken += it }, { fail("No foreground action is needed") }, pause = {})
            .follow(JSONObject().put("deliveryDeviceId", "phone").put("taskIds", JSONArray().put("same-task")))
        assertEquals(listOf("Only this phone's answer"), spoken)
    }
    @Test fun immediateAndFreshlyRedirectedRepliesCannotSpeakOnWrongDevice() = runBlocking {
        val spoken = mutableListOf<String>()
        for (recipient in listOf("tablet", "")) {
            WakeConversation("phone", { _, _, _ -> state() }, { true }, { spoken += it }, {}, pause = {})
                .follow(JSONObject().put("deliveryDeviceId", recipient).put("reply", "MUST STAY SILENT"))
        }
        var reads = 0; var receiptReads = 0
        fun message(recipient: String) = JSONObject().put("id", "reply").put("role", "assistant").put("taskId", "task")
            .put("deliveryDeviceId", recipient).put("content", "CHANGED RECIPIENT")
        WakeConversation("phone", { method, path, body ->
            if (path == "/api/chats/receipts") {
                assertEquals("POST", method)
                assertEquals("task", body!!.getJSONArray("taskIds").getString(0)); receiptReads++
                // The archive was read before the newer state changed the recipient.
                JSONObject().put("messages", JSONArray().put(message("phone")))
            } else {
                assertEquals("GET", method); assertEquals("/api/state", path); reads++
                state(JSONArray().put(message(if (reads <= 2) "phone" else "tablet"))).put("tasks", JSONArray().put(
                    JSONObject().put("id", "task").put("deliveryDeviceId", "phone").put("status", if (reads <= 2) "running" else "completed")))
            }
        }, { true }, { spoken += it }, {}, pause = {})
            .follow(JSONObject().put("deliveryDeviceId", "phone").put("taskIds", JSONArray().put("task")))
        assertTrue(receiptReads >= 2)
        assertTrue(spoken.isEmpty())
    }
    @Test fun attentionAndActionExecutionHaveSeparateExplicitRecipients() {
        val items = JSONArray()
        for (recipient in listOf("phone", "tablet", "desktop", "")) items.put(JSONObject().put("id", "notice:$recipient").put("kind", "question").put("deliveryDeviceId", recipient))
        val attention = JSONObject().put("version", 1).put("items", items)
        assertEquals(listOf("notice:phone"), AttentionPolicy.forDevice(attention, "phone").map { it.id })
        val remoteAction = JSONObject().put("deviceId", "tablet").put("requestedBy", "phone").put("deliveryDeviceId", "phone")
        assertFalse(DeviceDelivery.executesHere(remoteAction, "phone"))
        assertTrue(DeviceDelivery.executesHere(remoteAction, "tablet"))
        assertTrue(DeviceDelivery.addressedTo(remoteAction, "phone"))
        assertFalse(DeviceDelivery.addressedTo(remoteAction, "tablet"))
        assertFalse(DeviceDelivery.executesHere(JSONObject(), "phone"))
    }
    @Test fun alarmMembershipUsesExplicitSetAndNeverProjectedFallback() {
        val alarm = JSONObject().put("targetDeviceId", "phone").put("targetDeviceIds", JSONArray().put("phone").put("tablet"))
        assertEquals(setOf("phone", "tablet"), DeviceDelivery.alarmTargets(alarm))
        alarm.put("targetDeviceIds", JSONArray().put("tablet"))
        assertFalse("phone" in DeviceDelivery.alarmTargets(alarm))
        alarm.put("targetDeviceIds", JSONArray())
        assertTrue(DeviceDelivery.alarmTargets(alarm).isEmpty())
        assertEquals(setOf("phone"), DeviceDelivery.alarmTargets(JSONObject().put("targetDeviceId", "phone")))
    }
    @Test fun alarmReceiptsRemainIndependentAndMustMatchCurrentRevision() {
        val routine = JSONObject().put("updatedAt", "revision-2").put("targetDeviceIds", JSONArray().put("phone").put("tablet"))
            .put("deviceSchedules", JSONObject()
                .put("phone", JSONObject().put("deviceId", "phone").put("expectedUpdatedAt", "revision-2").put("status", "scheduled"))
                .put("tablet", JSONObject().put("deviceId", "tablet").put("expectedUpdatedAt", "revision-1").put("status", "scheduled")))
        assertEquals("scheduled", DeviceDelivery.alarmReceipt(routine, "phone")?.optString("status"))
        assertNull(DeviceDelivery.alarmReceipt(routine, "tablet"))
        assertNull(DeviceDelivery.alarmReceipt(routine, "other"))
        routine.getJSONObject("deviceSchedules").getJSONObject("tablet").put("expectedUpdatedAt", "revision-2").put("status", "permission_required")
        assertEquals("permission_required", DeviceDelivery.alarmReceipt(routine, "tablet")?.optString("status"))
        assertEquals("scheduled", DeviceDelivery.alarmReceipt(routine, "phone")?.optString("status"))
    }

    @Test fun remoteTimerRepeatedReceiptNeverSchedulesTwiceOrOnAnotherDevice() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = HostIdentity("https://fixture.invalid", "a".repeat(64), "synthetic", "fixture-" + java.util.UUID.randomUUID(), "Fixture")
        val action = JSONObject().put("id", "action").put("deviceId", identity.deviceId).put("deliveryDeviceId", "origin")
            .put("requestedBy", "origin").put("type", "timer_start")
            .put("args", JSONObject().put("durationSeconds", 600).put("title", "Synthetic tea").put("requestId", "same-request"))
        val key = RemotePhoneTimers.key(identity, "origin", "same-request")
        val preferences = context.getSharedPreferences("nakama_remote_timer_receipts", 0)
        var creates = 0
        val create: (Long, String, String) -> LocalTimer = { seconds, title, id -> creates++; LocalTimer(id, title, seconds * 1000, seconds * 1000, "running", 1, 1000) }
        try {
            val first = RemotePhoneTimers.execute(context, identity, action, create)
            val repeat = RemotePhoneTimers.execute(context, identity, action, create)
            assertEquals("completed", first.status); assertEquals(first.json().toString(), repeat.json().toString()); assertEquals(1, creates)
            action.getJSONObject("args").put("durationSeconds", 60)
            assertThrows(IllegalStateException::class.java) { RemotePhoneTimers.execute(context, identity, action, create) }
            assertEquals(1, creates)
            action.put("deviceId", "other")
            assertThrows(IllegalArgumentException::class.java) { RemotePhoneTimers.execute(context, identity, action, create) }
            assertEquals(1, creates)
        } finally { check(preferences.edit().remove(key).commit()) }
    }
}
