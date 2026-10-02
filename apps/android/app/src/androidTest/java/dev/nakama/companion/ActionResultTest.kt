package dev.nakama.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ActionResultTest {
    @Test fun receiptRoundTripRetainsStructuredObservationAndTimestamp() {
        val source = ActionResult("completed", "Read one visible control.", JSONObject().put("observedAt", "2026-09-29T14:00:00Z").put("controls", JSONArray().put(JSONObject().put("label", "Send"))))
        val encoded = source.json().toString()
        val restored = ActionResult.fromJson(JSONObject(encoded))
        assertEquals(encoded, restored.json().toString())
        assertEquals("Send", restored.data!!.getJSONArray("controls").getJSONObject(0).getString("label"))
        assertFalse(ActionResult("needs_user", "Nothing sent").json().has("data"))
    }
}
