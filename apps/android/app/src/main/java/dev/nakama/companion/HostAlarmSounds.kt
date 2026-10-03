package dev.nakama.companion

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.UUID

/** Download only an assigned manifest ID through the pinned host connection; never a source URL. */
internal object HostAlarmSounds {
    private val lock = Any()
    private fun key(identity: HostIdentity, id: String) = AlarmSoundPolicy.sha256((identity.fingerprint + ":" + identity.deviceId + ":" + id).toByteArray())
    private fun root(context: Context) = File(context.filesDir, "alarm-sounds").apply { check(isDirectory || mkdirs()) }
    private fun parse(value: JSONObject): AlarmSoundSpec {
        require(value.optString("mimeType") == "audio/wav") { "Unsupported alarm sound format." }
        return AlarmSoundSpec(value.getString("id"), value.getString("sha256"), value.getInt("byteLength"), value.getLong("durationMs")).also { require(AlarmSoundPolicy.valid(it)) { "Invalid alarm sound manifest." } }
    }
    fun file(context: Context, identity: HostIdentity, id: String): File? = synchronized(lock) {
        runCatching {
            val stem = key(identity, id); val directory = root(context)
            val metadata = File(directory, "$stem.json"); require(metadata.length() in 1..16_384)
            val spec = parse(JSONObject(metadata.readText()))
            require(spec.id == id)
            File(directory, "$stem.wav").takeIf { it.isFile && it.length() == spec.byteLength.toLong() && AlarmSoundPolicy.verify(spec, it.readBytes()) }
        }.getOrNull()
    }
    suspend fun sync(context: Context, identity: HostIdentity, snapshot: JSONObject, current: () -> Boolean, request: suspend (String) -> JSONObject = { path -> HostClient(identity).request("GET", path) }) {
        val selected = snapshot.optJSONObject("routineBoard")?.objects("routines").orEmpty().filter { it.optString("kind") == "alarm" && it.optBoolean("enabled") && identity.deviceId in DeviceDelivery.alarmTargets(it) }
        val wanted = selected.map { it.alarmSoundId() }.filter { it.isNotBlank() }.toSet()
        for (id in wanted) {
            check(current()) { "The pairing changed before sound download." }
            val row = snapshot.objects("alarmSounds").firstOrNull { it.optString("id") == id } ?: continue
            val spec = runCatching { parse(row) }.getOrNull() ?: continue
            withContext(Dispatchers.IO) {
                if (file(context, identity, id)?.let { AlarmSoundPolicy.sha256(it.readBytes()) == spec.sha256 } == true) return@withContext
                val result = request("/api/alarm-sounds/$id/audio")
                require(parse(result) == spec) { "The alarm sound changed during download." }
                val encoded = result.getString("base64")
                require(encoded.length <= (AlarmSoundPolicy.MAX_BYTES + 2) / 3 * 4)
                val bytes = Base64.getDecoder().decode(encoded)
                try {
                    require(AlarmSoundPolicy.verify(spec, bytes)) { "Alarm sound verification failed." }
                    check(current() && PairingVault(context).load() == identity) { "The pairing changed during sound download." }
                    synchronized(lock) {
                        val directory = root(context); val stem = key(identity, id)
                        val stage = File(directory, ".stage-${UUID.randomUUID()}")
                        try { stage.outputStream().use { it.write(bytes); it.fd.sync() }; check(current()); check(stage.renameTo(File(directory, "$stem.wav"))) }
                        finally { stage.delete() }
                        File(directory, "$stem.json").writeText(row.toString())
                    }
                } finally { bytes.fill(0) }
            }
        }
    }
}

/** JSON null means Android's default alarm sound, not a library ID named null. */
internal fun JSONObject.alarmSoundId(): String = opt("soundId").takeUnless { it == null || it == JSONObject.NULL }?.toString().orEmpty()
