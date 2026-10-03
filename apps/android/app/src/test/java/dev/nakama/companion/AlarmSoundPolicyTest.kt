package dev.nakama.companion

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

class AlarmSoundPolicyTest {
    private fun clip(): ByteArray {
        val bytes = ByteArray(44 + 44_100); val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        data.put("RIFF".toByteArray()).putInt(bytes.size - 8).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(22_050).putInt(44_100).putShort(2).putShort(16).put("data".toByteArray()).putInt(44_100)
        return bytes
    }
    private fun spec(bytes: ByteArray) = AlarmSoundSpec("fixture-clip", AlarmSoundPolicy.sha256(bytes), bytes.size, 1000)
    @Test fun acceptsOnlyExactManifestBoundedPcm() { val bytes = clip(); val spec = spec(bytes); assertTrue(AlarmSoundPolicy.verify(spec, bytes)); assertFalse(AlarmSoundPolicy.verify(spec.copy(id = "../escape"), bytes)); assertFalse(AlarmSoundPolicy.verify(spec.copy(durationMs = 30_001), bytes)); assertFalse(AlarmSoundPolicy.verify(spec.copy(byteLength = bytes.size + 1), bytes)); bytes[100] = 1; assertFalse(AlarmSoundPolicy.verify(spec, bytes)) }
    @Test fun rejectsChangedFormatTrailingContentAndFalseDuration() {
        val changed = clip(); changed[20] = 3; assertFalse(AlarmSoundPolicy.verify(spec(changed), changed))
        val truncated = clip().copyOf(42); assertFalse(AlarmSoundPolicy.verify(spec(truncated), truncated))
        val appended = clip() + byteArrayOf(0); assertFalse(AlarmSoundPolicy.verify(spec(appended), appended))
        val bytes = clip(); assertFalse(AlarmSoundPolicy.verify(spec(bytes).copy(durationMs = 500), bytes))
    }
}
