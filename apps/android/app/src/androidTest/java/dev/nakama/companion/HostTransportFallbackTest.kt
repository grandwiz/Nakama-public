package dev.nakama.companion

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Ephemeral synthetic loopback server supplied by the fixture runner; no account or real host. */
@RunWith(AndroidJUnit4::class)
class HostTransportFallbackTest {
    private fun identity(port: Int, token: String): HostIdentity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_"))
        val pin = InstrumentationRegistry.getArguments().getString("fixture_pin") ?: error("Supply the ephemeral synthetic TLS fixture pin.")
        return HostIdentity("https://10.0.2.2:$port", pin, "synthetic-$token-${System.nanoTime()}", "fixture-phone", "Synthetic transport")
    }
    private fun counts() = HostClient(identity(61200, "counts")).request("GET", "/api/counts")
    @Test fun unreachablePrimaryUsesPinnedAlternateBeforeSendingPostBody() {
        val saved = identity(1, "dead-primary"); HostClient.rememberEndpoints(saved, JSONArray().put("https://10.0.2.2:61201"))
        val before = counts(); val response = HostClient(saved).request("POST", "/api/ok", JSONObject().put("message", "Synthetic one-time submission"))
        assertEquals("POST", response.getString("method")); assertTrue(response.get("body").toString().contains("Synthetic one-time submission"))
        val after = counts(); assertEquals(before.getInt("primary"), after.getInt("primary")); assertEquals(before.getInt("alternate") + 1, after.getInt("alternate"))
        assertEquals("https://10.0.2.2:61201", HostClient.connectionCandidates(saved).first())
        assertEquals("https://10.0.2.2:1", HostClient.connectionCandidates(saved.copy(token = saved.token + "-new")).first())
        HostClient(saved).request("GET", "/api/ok")
        assertEquals(before.getInt("alternate") + 2, counts().getInt("alternate"))
        HostClient.rememberEndpoints(saved, JSONArray().put("https://10.0.2.2:61200"))
        assertEquals("A removed address cannot stay preferred", "https://10.0.2.2:1", HostClient.connectionCandidates(saved).first())
        assertFalse(HostClient.connectionCandidates(saved).contains("https://10.0.2.2:61201"))
        HostClient.rememberEndpoints(saved, JSONArray())
        assertEquals(listOf("https://10.0.2.2:1"), HostClient.connectionCandidates(saved))
    }
    @Test fun wrongCertificateCannotFallBackToTrustedAlternate() {
        val saved = identity(61202, "wrong-pin"); HostClient.rememberEndpoints(saved, JSONArray().put("https://10.0.2.2:61201"))
        val before = counts(); var rejected = false
        try { HostClient(saved).request("POST", "/api/ok", JSONObject().put("message", "Must not dispatch")) } catch (_: javax.net.ssl.SSLException) { rejected = true }
        assertTrue(rejected); assertEquals(before.toString(), counts().toString())
    }
    @Test fun acceptedPostWithLostResponseIsNotReplayedAnywhere() {
        val saved = identity(61200, "drop"); HostClient.rememberEndpoints(saved, JSONArray().put("https://10.0.2.2:61201"))
        val before = counts(); var ambiguous = false
        try { HostClient(saved).request("POST", "/api/drop", JSONObject().put("message", "Exactly one synthetic side effect")) } catch (_: java.io.IOException) { ambiguous = true }
        assertTrue(ambiguous); val after = counts()
        assertEquals("Dropped response must not repeat the accepted request", before.getInt("primary") + 1, after.getInt("primary"))
        assertEquals(before.getInt("alternate"), after.getInt("alternate")); assertEquals(before.getInt("wrong"), after.getInt("wrong"))
    }
}
