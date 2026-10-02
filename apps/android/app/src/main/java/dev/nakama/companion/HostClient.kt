package dev.nakama.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.net.URL
import java.net.InetAddress
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import org.json.JSONObject

/** Pairing is an explicit out-of-band trust exchange. There is no accept-all TLS mode. */
object PairingValidation {
    fun fingerprint(value: String): String {
        val normalized = value.replace(":", "").trim().lowercase()
        require(normalized.matches(Regex("[0-9a-f]{64}"))) { "The certificate fingerprint must contain 64 hexadecimal characters." }
        return normalized
    }

    fun endpoint(value: String): String {
        val uri = URI(value.trim())
        require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Use a secure https:// host address." }
        require(uri.rawUserInfo == null && uri.query == null && uri.fragment == null) { "The address must not contain credentials, a query or a fragment." }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "Use the host address without an API path." }
        return uri.toString().trimEnd('/')
    }

    /** A phone cannot reach the PC through an address that refers to the phone itself. */
    fun deviceEndpoint(value: String): String {
        val uri = URI(value.trim())
        // URI rejects some IPv4 shorthand as a host. Classify a plain authority
        // too, so those invalid tickets receive the same useful phone guidance.
        val rawHost = uri.host ?: Regex("^([^:@]+)(?::[0-9]+)?$").matchEntire(uri.rawAuthority.orEmpty())?.groupValues?.get(1)
        val host = rawHost?.lowercase()?.removePrefix("[")?.removeSuffix("]")?.trimEnd('.') ?: return endpoint(value)
        // Parse literals only: validation must not resolve a hostname or contact the network.
        val literal = if (host.contains(':')) {
            runCatching { InetAddress.getByName(host) }.getOrNull()
        } else null
        require(host != "localhost" && !host.endsWith(".localhost") &&
            literal?.isLoopbackAddress != true && literal?.isAnyLocalAddress != true &&
            !isIpv4SelfAddress(host, false) && !isIpv4SelfAddress(host, true)) {
            "This pairing address points to this phone, not your PC. In Control Center, choose your PC's private Wi-Fi/LAN or VPN address and create a new pairing ticket. Do not use localhost, 127.0.0.1 or 0.0.0.0."
        }
        return endpoint(value)
    }

    private fun isIpv4SelfAddress(host: String, legacy: Boolean): Boolean {
        // Some resolvers accept IPv4 shorthand, octal or hex. Do not let those forms
        // turn a phone pairing ticket into a request back to the phone.
        val parts = host.split('.')
        if (parts.size !in 1..4) return false
        val values = parts.map { part ->
            when {
                legacy && part.startsWith("0x") -> part.drop(2).toLongOrNull(16)
                legacy && part.length > 1 && part.startsWith('0') -> part.toLongOrNull(8)
                part.all { it.isDigit() } -> part.toLongOrNull()
                else -> null
            } ?: return false
        }
        var address = 0L
        for (index in values.indices) {
            val bits = if (index == values.lastIndex) 8 * (5 - values.size) else 8
            val value = values[index]
            if (value < 0 || value >= (1L shl bits)) return false
            address = (address shl bits) or value
        }
        return address == 0L || address ushr 24 == 127L
    }
}

data class HostIdentity(val url: String, val fingerprint: String, val token: String, val deviceId: String, val name: String) {
    fun json() = JSONObject().put("url", url).put("fingerprint", fingerprint).put("token", token).put("deviceId", deviceId).put("name", name)
}

/** Android Keystore protects the key; preferences contain only authenticated ciphertext. */
class PairingVault(context: Context) {
    private val prefs = context.getSharedPreferences("nakama_secure", Context.MODE_PRIVATE)
    private val alias = "nakama-device-pairing-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(identity: HostIdentity) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(identity.json().toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Could not save pairing securely." }
    }
    fun load(): HostIdentity? {
        val data = prefs.getString("data", null) ?: return null
        return runCatching {
            val iv = Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
            val json = JSONObject(String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8))
            HostIdentity(PairingValidation.endpoint(json.getString("url")), PairingValidation.fingerprint(json.getString("fingerprint")), json.getString("token"), json.getString("deviceId"), json.getString("name"))
        }.getOrNull()
    }
    fun clear() { prefs.edit().clear().commit() }
}

class HostClient(private val url: String, fingerprint: String, private val token: String? = null) {
    constructor(identity: HostIdentity) : this(identity.url, identity.fingerprint, identity.token)
    private val pin = PairingValidation.fingerprint(fingerprint)
    private val tls = SSLContext.getInstance("TLS").apply {
        init(null, arrayOf(object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { throw java.security.cert.CertificateException("Client trust is not supported") }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (chain.isEmpty()) throw java.security.cert.CertificateException("Missing certificate")
                chain[0].checkValidity()
                val actual = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded).joinToString("") { "%02x".format(it) }
                if (!MessageDigest.isEqual(actual.toByteArray(), pin.toByteArray())) throw java.security.cert.CertificateException("The host certificate changed. Pair again from Control Center.")
            }
        }), SecureRandom())
    }

    fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        require(path.startsWith("/api/") && !path.contains("..")) { "Invalid API path" }
        val connection = URL(PairingValidation.endpoint(url) + path).openConnection() as HttpsURLConnection
        connection.sslSocketFactory = tls.socketFactory
        // An exact certificate pin authenticates a private host regardless of its VPN/LAN hostname.
        // This verifier is deliberately not usable without the mandatory trust manager above.
        connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, session ->
            val leaf = session.peerCertificates.firstOrNull() as? X509Certificate
            leaf != null && MessageDigest.getInstance("SHA-256").digest(leaf.encoded).joinToString("") { "%02x".format(it) } == pin
        }
        connection.requestMethod = method
        connection.connectTimeout = 10_000
        connection.readTimeout = 25_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        try {
            body?.let {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { stream -> stream.write(it.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readNBytes(2_000_001) } ?: byteArrayOf()
            check(bytes.size <= 2_000_000) { "Host response is too large." }
            val raw = String(bytes, Charsets.UTF_8)
            val result = if (raw.isBlank()) JSONObject() else JSONObject(raw)
            if (status !in 200..299) throw HostException(status, result.optString("error", "Host request failed ($status)"))
            return result
        } finally { connection.disconnect() }
    }
}

class HostException(val status: Int, message: String) : Exception(message)

fun JSONObject.objects(key: String): List<JSONObject> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}
