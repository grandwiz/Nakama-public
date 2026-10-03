package dev.nakama.companion

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

internal data class AlarmSoundSpec(val id: String, val sha256: String, val byteLength: Int, val durationMs: Long)
internal object AlarmSoundPolicy {
    const val MAX_BYTES = 1_324_000
    fun valid(spec: AlarmSoundSpec) = spec.id.matches(Regex("[A-Za-z0-9_-]{1,100}")) && spec.sha256.matches(Regex("[a-f0-9]{64}")) && spec.byteLength in 46..MAX_BYTES && spec.durationMs in 1..30_000
    fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun verify(spec: AlarmSoundSpec, bytes: ByteArray): Boolean = runCatching {
        require(valid(spec) && bytes.size == spec.byteLength && sha256(bytes) == spec.sha256)
        val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        fun tag(at: Int) = String(bytes, at, 4, Charsets.US_ASCII)
        require(tag(0) == "RIFF" && data.getInt(4).toLong() + 8 == bytes.size.toLong() && tag(8) == "WAVE")
        var at = 12; var format = false; var samples = 0
        while (at + 8 <= bytes.size) {
            val size = data.getInt(at + 4); require(size >= 0 && size <= bytes.size - at - 8)
            when (tag(at)) {
                "fmt " -> { require(!format && size >= 16 && data.getShort(at + 8).toInt() == 1 && data.getShort(at + 10).toInt() == 1 && data.getInt(at + 12) == 22_050 && data.getInt(at + 16) == 44_100 && data.getShort(at + 20).toInt() == 2 && data.getShort(at + 22).toInt() == 16); format = true }
                "data" -> { require(format && samples == 0 && size > 0 && size % 2 == 0); samples = size / 2 }
                else -> error("Only plain PCM wave clips are supported.")
            }
            at += 8 + size + size % 2
        }
        require(at == bytes.size && samples in 1..661_500 && kotlin.math.abs(samples * 1000L / 22_050 - spec.durationMs) <= 2)
        true
    }.getOrDefault(false)
}
