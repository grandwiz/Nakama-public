package dev.nakama.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AlarmReceiptPolicyTest {
    private fun response() = JSONObject("""{"deliveryDeviceId":"phone","outcome":{"type":"routine_created","kind":"alarm","id":"alarm","updatedAt":"v2","targetDeviceIds":["phone"]}}""")
    private fun routine() = response().getJSONObject("outcome").put("enabled", true)
    @Test fun onlyOwnAcceptedAlarmVersionCanRequestSchedulingFeedback() {
        assertEquals(AlarmRequestReceipt("alarm", "v2"), AlarmReceiptPolicy.request(response(), "phone"))
        assertNull(AlarmReceiptPolicy.request(response(), "tablet"))
        assertNull(AlarmReceiptPolicy.request(response().put("deliveryDeviceId", "tablet"), "phone"))
        assertNull(AlarmReceiptPolicy.request(response().apply { getJSONObject("outcome").remove("updatedAt") }, "phone"))
        assertNull(AlarmReceiptPolicy.request(response().apply { getJSONObject("outcome").put("targetDeviceIds", org.json.JSONArray("[\"tablet\"]")) }, "phone"))
    }
    @Test fun optInAndVersionMustMatchBeforeAnyScheduledClaim() {
        val request = AlarmRequestReceipt("alarm", "v2")
        val scheduled = JSONObject("""{"expectedUpdatedAt":"v2","status":"scheduled"}""")
        assertTrue(AlarmReceiptPolicy.feedback(request, "phone", listOf(routine()), false, scheduled)!!.needsSetup)
        assertFalse(AlarmReceiptPolicy.feedback(request, "phone", listOf(routine()), true, scheduled)!!.needsSetup)
        assertTrue(AlarmReceiptPolicy.feedback(request, "phone", listOf(routine()), true, scheduled.put("expectedUpdatedAt", "v1"))!!.needsSetup)
        assertNull(AlarmReceiptPolicy.feedback(request, "phone", listOf(routine().put("updatedAt", "v3")), true, scheduled))
        assertNull(AlarmReceiptPolicy.feedback(request, "tablet", listOf(routine()), true, scheduled))
    }
    @Test fun deniedPermissionProducesSetupGuidanceWithoutClaimingSuccess() {
        val receipt = JSONObject("""{"expectedUpdatedAt":"v2","status":"permission_required","detail":"Allow Alarms & reminders"}""")
        val feedback = AlarmReceiptPolicy.feedback(AlarmRequestReceipt("alarm", "v2"), "phone", listOf(routine()), true, receipt)!!
        assertTrue(feedback.needsSetup); assertTrue(feedback.text.contains("Allow Alarms & reminders")); assertFalse(feedback.text.contains("registered"))
    }
    @Test fun expiredOneShotRestoreInvalidatesRegistrationAndRefreshRevision() {
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val vault = PairingVault(context); val previousIdentity = vault.load()
        val preferences = context.getSharedPreferences("nakama_phone_alarms", android.content.Context.MODE_PRIVATE)
        val previous = preferences.all.toMap()
        try {
            vault.save(HostIdentity("https://127.0.0.1:43110", "a".repeat(64), "synthetic-fixture-token", "phone", "Synthetic fixture"))
            val alarm = routine().put("time", "07:00").put("timeZone", "UTC").put("scheduledDate", "2000-01-01").put("weekdays", org.json.JSONArray())
            preferences.edit().clear().putString("deviceId", "phone").putBoolean("syncEnabled", true)
                .putString("routines", JSONObject().put("alarm", alarm).toString())
                .putString("receipts", JSONObject().put("alarm", JSONObject("""{"expectedUpdatedAt":"v2","status":"scheduled"}""")).toString()).commit()
            val before = PhoneAlarmScheduler.revision(context, listOf(alarm))
            PhoneAlarmScheduler.restore(context)
            assertNotEquals(before, PhoneAlarmScheduler.revision(context, listOf(alarm)))
            val receipt = JSONObject(preferences.getString("receipts", "{}").orEmpty()).getJSONObject("alarm")
            assertNotEquals("scheduled", receipt.getString("status"))
            assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", receipt.optString("expectedUpdatedAt"), receipt.optString("status"), true, true, false))
        } finally {
            val editor = preferences.edit().clear()
            for ((key, value) in previous) when (value) { is String -> editor.putString(key, value); is Boolean -> editor.putBoolean(key, value); is Long -> editor.putLong(key, value); is Int -> editor.putInt(key, value) }
            editor.commit()
            if (previousIdentity == null) vault.clear() else vault.save(previousIdentity)
        }
    }

}
