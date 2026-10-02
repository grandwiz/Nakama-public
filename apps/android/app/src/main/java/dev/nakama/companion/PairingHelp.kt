package dev.nakama.companion

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException

/** Explanations for initial pairing only; they never relax connection or certificate checks. */
object PairingHelp {
    fun connectionError(error: Exception): String {
        val causes = generateSequence<Throwable>(error) { it.cause }.take(12).toList()
        return when {
            causes.any { it is SSLException || it is CertificateException } ->
                "Could not verify your PC's secure connection. Check the date and time on both devices, then create a new pairing ticket in Control Center. Certificate checks remain enabled."
            causes.any { it is UnknownHostException } ->
                "Could not find your PC's address. Use its current private Wi-Fi/LAN or VPN address in Control Center, then create a new pairing ticket. Connect both devices to the same Wi-Fi or private VPN."
            causes.any { it is ConnectException || it is NoRouteToHostException || it is SocketTimeoutException } ->
                "Could not reach Control Center. Keep your PC awake and Control Center open, enable its private-network connection, and connect both devices to the same Wi-Fi or private VPN. Check Windows Firewall allows Nakama on your private network."
            error is HostException && error.status == 401 ->
                "Your PC rejected this pairing ticket. It may have expired or already been used. Create a new ticket in Control Center and copy it again."
            error is HostException && error.status == 403 ->
                "Control Center refused pairing. Check that device access is enabled on your PC."
            error is HostException && error.status == 429 ->
                "There have been too many pairing attempts. Wait a moment, then create a fresh ticket in Control Center."
            // Transport/server diagnostics can contain URLs or request data. Do not
            // echo them in a notice containing a one-use ticket or device token.
            else -> "Pairing did not finish. Check Control Center and try again."
        }
    }
}
