package dev.nakama.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingValidationTest {
    @Test fun onlyHttpsOriginsAreAccepted() {
        assertEquals("https://100.65.2.1:43110", PairingValidation.endpoint("https://100.65.2.1:43110/"))
        for (unsafe in listOf("http://localhost:43110", "https://user:pass@host", "https://host/api/state", "https://host?token=secret", "https://host#fragment")) {
            assertThrows(IllegalArgumentException::class.java) { PairingValidation.endpoint(unsafe) }
        }
    }
    @Test fun fingerprintsAreExactSha256Values() {
        val colon = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), PairingValidation.fingerprint(colon))
        for (invalid in listOf("", "abc", "zz".repeat(32), "ab".repeat(33))) {
            assertThrows(IllegalArgumentException::class.java) { PairingValidation.fingerprint(invalid) }
        }
    }

    @Test fun phonePairingRejectsSelfAndUnspecifiedAddressesBeforeNetworking() {
        for (host in listOf("localhost", "LOCALHOST.", "pc.localhost", "127.0.0.1", "127.0.0.2", "127.12.3.4", "127.008.0.1", "127.1", "2130706433", "0177.0.0.1", "0x7f000001", "0.0.0.0", "0", "[::1]", "[0:0:0:0:0:0:0:1]", "[::]", "[::ffff:127.0.0.1]", "[::ffff:0.0.0.0]")) {
            val error = assertThrows("Must reject $host", IllegalArgumentException::class.java) {
                PairingValidation.deviceEndpoint("https://$host:43110")
            }
            assertTrue("$host: ${error.message}", error.message.orEmpty().contains("create a new pairing ticket"))
        }
    }

    @Test fun phonePairingAcceptsLanVpnAndDnsWhileKeepingHttpsRules() {
        for (host in listOf("192.168.1.10", "10.0.0.12", "100.65.2.1", "pc.example.ts.net", "[fd00::12]")) {
            val endpoint = "https://$host:43110"
            assertEquals(endpoint, PairingValidation.deviceEndpoint("$endpoint/"))
        }
        for (unsafe in listOf("http://192.168.1.10:43110", "https://user:pass@192.168.1.10", "https://192.168.1.10/api/state")) {
            assertThrows(IllegalArgumentException::class.java) { PairingValidation.deviceEndpoint(unsafe) }
        }
        // Direct HostClient integration fixtures retain their pinned ADB-reverse endpoint.
        assertEquals("https://127.0.0.1:43120", PairingValidation.endpoint("https://127.0.0.1:43120"))
    }
}
