package dev.nakama.companion

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Run only against tools/integration-host.mjs, never the user's real Control Center. */
@RunWith(AndroidJUnit4::class)
class HostIntegrationTest {
    @Test fun pinnedPairingVaultAndProjectRoundTrip() {
        val encoded = InstrumentationRegistry.getArguments().getString("pairing") ?: throw IllegalArgumentException("Pass the disposable fixture's pairing JSON as base64 in -e pairing.")
        val pairing = JSONObject(String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8))
        val url = pairing.getString("url")
        require(url == "https://127.0.0.1:43120") { "Integration tests only use the disposable local fixture on port 43120." }
        var rejected = false
        try { HostClient(url, "00".repeat(32)).request("GET", "/api/state") }
        catch (error: javax.net.ssl.SSLException) { rejected = true }
        assertTrue("A wrong certificate pin must fail before an API request", rejected)
        val paired = HostClient(url, pairing.getString("fingerprint")).request("POST", "/api/pair", JSONObject().put("ticket", pairing.getString("ticket")).put("name", "Nakama emulator test").put("platform", "android"))
        val saved = HostIdentity(url, pairing.getString("fingerprint"), paired.getString("token"), paired.getString("deviceId"), paired.getString("hostName"))
        val vault = PairingVault(InstrumentationRegistry.getInstrumentation().targetContext)
        vault.save(saved)
        val restored = vault.load()!!
        assertEquals(saved.token, restored.token)
        val client = HostClient(restored)
        val state = client.request("GET", "/api/state")
        assertEquals("Nakama Android test host", state.getJSONObject("config").getString("hostName"))
        assertFalse("Public state must not reveal bearer tokens", state.toString().contains(saved.token))
        val project = client.request("POST", "/api/projects", JSONObject().put("name", "Android smoke ${System.currentTimeMillis()}").put("description", "Created by the Android integration test against a disposable host."))
        assertTrue(project.getString("id").isNotEmpty())
        assertTrue(client.request("GET", "/api/state").objects("projects").any { it.optString("id") == project.getString("id") })
        val accounts = client.request("GET", "/api/google/accounts").objects("accounts")
        assertEquals(2, accounts.size)
        assertEquals("personal@example.test", accounts.first().getString("email"))
        assertEquals("fixture-email", client.request("GET", "/api/google/fixture-personal/messages?q=is%3Aunread").objects("messages").single().getString("id"))
        assertEquals("primary", client.request("GET", "/api/google/fixture-personal/calendars").objects("items").single().getString("id"))
        assertEquals("Review Nakama", client.request("GET", "/api/google/fixture-personal/events?calendarId=primary").objects("items").single().getString("summary"))
        val emailRequest = client.request("POST", "/api/google/fixture-personal/send-email", JSONObject().put("to", "recipient@example.test").put("subject", "Fixture only").put("body", "Do not deliver this test message."))
        assertEquals("pending", emailRequest.getString("status"))
        assertEquals("google_action", emailRequest.getString("type"))
        var denied = false
        try { client.request("DELETE", "/api/devices/${saved.deviceId}") }
        catch (error: HostException) { denied = error.status == 403 }
        assertTrue("A paired phone must not be a desktop administrator", denied)
    }
}
