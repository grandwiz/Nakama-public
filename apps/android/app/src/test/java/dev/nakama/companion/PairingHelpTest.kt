package dev.nakama.companion

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingHelpTest {
    @Test fun unreachableHostExplainsConnectionSetupWithoutBlamingTheTicket() {
        for (error in listOf(ConnectException(), NoRouteToHostException(), SocketTimeoutException())) {
            val message = PairingHelp.connectionError(Exception("wrapped", error))
            assertTrue(message.contains("Keep your PC awake"))
            assertTrue(message.contains("private-network connection"))
            assertTrue(message.contains("Windows Firewall"))
            assertFalse(message.contains("rejected this pairing ticket"))
        }
    }

    @Test fun unknownNameExplainsAddressAndCertificateFailuresKeepTrustChecks() {
        assertTrue(PairingHelp.connectionError(UnknownHostException()).contains("current private Wi-Fi/LAN or VPN address"))
        for (error in listOf(SSLHandshakeException("handshake"), CertificateException("pin mismatch"))) {
            val message = PairingHelp.connectionError(Exception("wrapped", error))
            assertTrue(message.contains("Check the date and time"))
            assertTrue(message.contains("Certificate checks remain enabled"))
            assertFalse(message.contains("Could not reach"))
        }
    }

    @Test fun rejectedTicketIsDistinctFromOtherServerAndLocalFailures() {
        assertTrue(PairingHelp.connectionError(HostException(401, "invalid")).contains("expired or already been used"))
        assertTrue(PairingHelp.connectionError(HostException(403, "private diagnostics")).contains("device access is enabled"))
        assertTrue(PairingHelp.connectionError(HostException(429, "private diagnostics")).contains("too many pairing attempts"))
        val message = PairingHelp.connectionError(IllegalStateException("ticket=private-token"))
        assertEquals("Pairing did not finish. Check Control Center and try again.", message)
        assertFalse(message.contains("private-token"))
    }
}
