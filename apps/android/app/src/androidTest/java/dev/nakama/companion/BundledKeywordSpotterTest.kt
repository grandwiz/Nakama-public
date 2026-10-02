package dev.nakama.companion

import android.os.Build
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest
import kotlin.math.abs

/** Packaged native keyword network, checked synthetic PCM only; never opens a microphone. */
@RunWith(AndroidJUnit4::class)
class BundledKeywordSpotterTest {
    private val assets get() = InstrumentationRegistry.getInstrumentation().context.assets
    private fun emulatorOnly() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
    }
    private fun fixtures(folder: String): List<JSONObject> {
        val manifest = JSONArray(assets.open("$folder/manifest.json").bufferedReader().use { it.readText() })
        return (0 until manifest.length()).map(manifest::getJSONObject)
    }
    private fun pcm(folder: String, fixture: JSONObject): ShortArray {
        val file = fixture.getString("file")
        require(file.matches(Regex("[a-z0-9-]+\\.wav")))
        val bytes = assets.open("$folder/$file").use { it.readBytes() }
        require(bytes.size in 44..2 * 1024 * 1024)
        val sha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        assertEquals("Synthetic fixture checksum: $file", fixture.getString("sha256"), sha256)
        try { return wavPcm(bytes) } finally { bytes.fill(0) }
    }
    private fun detect(samples: ShortArray): List<WakeDetection> {
        val detector = BundledKeywordSpotters.open(InstrumentationRegistry.getInstrumentation().targetContext)
        val hits = mutableListOf<WakeDetection>()
        val chunk = ShortArray(1600)
        try {
            var offset = 0
            while (offset < samples.size) {
                val count = minOf(chunk.size, samples.size - offset)
                samples.copyInto(chunk, 0, offset, offset + count)
                detector.accept(chunk, count)?.let(hits::add)
                chunk.fill(0); offset += count
            }
            repeat(8) { detector.accept(chunk, chunk.size)?.let(hits::add) }
            return hits
        } finally { chunk.fill(0); detector.close() }
    }

    @Test fun exactWakeLabelsDetectAllEightSyntheticPositivesAndRejectTwentySixNearMatches() {
        emulatorOnly()
        val original = fixtures("speech-fixtures")
        val extra = fixtures("speech-fixtures/kws-extra")
        assertEquals(18, original.size); assertEquals(16, extra.size)
        assertEquals(8, original.count { it.getBoolean("expectedWake") })
        assertTrue(extra.none { it.getBoolean("expectedWake") })
        val failures = mutableListOf<String>()
        for ((folder, examples) in listOf("speech-fixtures" to original, "speech-fixtures/kws-extra" to extra)) {
            for (fixture in examples) {
                val samples = pcm(folder, fixture)
                val hits = try { detect(samples) } finally { samples.fill(0) }
                val expected = fixture.getBoolean("expectedWake")
                Log.i("NakamaSyntheticKws", "${fixture.getString("file")}: expected=$expected, detected=$hits")
                if (expected != hits.isNotEmpty()) failures += "${fixture.getString("file")}: expected=$expected, detected=$hits"
                assertTrue("Only exact configured labels may open a command window", hits.all { it.phrase in setOf("Nakama", "Hey Nakama") })
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun silenceDcNoiseAndToneCannotAuthorizeCommands() {
        emulatorOnly()
        val random = java.util.Random(7321L)
        val examples = linkedMapOf(
            "silence" to ShortArray(48_000),
            "steady DC" to ShortArray(48_000) { 5000 },
            "quiet noise" to ShortArray(48_000) { (random.nextInt(65) - 32).toShort() },
            "moderate hiss" to ShortArray(48_000) { (random.nextInt(6001) - 3000).toShort() },
            "440 Hz tone" to ShortArray(48_000) { (5000 * kotlin.math.sin(2 * Math.PI * 440 * it / 16_000)).toInt().toShort() },
        )
        for ((name, samples) in examples) {
            val hits = try { detect(samples) } finally { samples.fill(0) }
            assertTrue("$name must not authorize a command: $hits", hits.isEmpty())
        }
    }

    @Test fun wakeTimestampRemainsAbsoluteAfterLongIdleAndNeverPointsIntoEarlierAudio() {
        emulatorOnly()
        val fixture = fixtures("speech-fixtures").single { it.getString("file") == "hazel-gb-wake-time.wav" }
        val samples = pcm("speech-fixtures", fixture)
        try {
            val baseline = detect(samples).firstOrNull()
            assertNotNull("Reference wake phrase must be detected", baseline)
            val random = java.util.Random(415L)
            for (noisy in listOf(false, true)) {
                val prefixSamples = 12 * 16_000
                val prefixed = ShortArray(prefixSamples + samples.size) { if (noisy && it < prefixSamples) (random.nextInt(65) - 32).toShort() else 0 }
                samples.copyInto(prefixed, prefixSamples)
                val hits = try { detect(prefixed) } finally { prefixed.fill(0) }
                assertTrue("Wake must still be detected after twelve seconds of idle; noise=$noisy", hits.isNotEmpty())
                for (hit in hits) {
                    assertTrue("Wake timestamp must not point into previous idle audio: $hit", hit.lastTokenSample >= prefixSamples)
                    assertTrue("Wake timestamp must stay inside its utterance: $hit", hit.lastTokenSample < prefixSamples + samples.size)
                    assertTrue("Timestamp offset must preserve the wake/command boundary: $hit vs $baseline", abs(hit.lastTokenSample - prefixSamples - baseline!!.lastTokenSample) <= 3_200)
                }
            }
        } finally { samples.fill(0) }
    }

    private fun wavPcm(bytes: ByteArray): ShortArray {
        fun text(at: Int, count: Int) = String(bytes, at, count, Charsets.US_ASCII)
        fun u16(at: Int) = (bytes[at].toInt() and 255) or ((bytes[at + 1].toInt() and 255) shl 8)
        fun u32(at: Int): Long = (0..3).fold(0L) { total, n -> total or ((bytes[at + n].toLong() and 255L) shl (8 * n)) }
        require(bytes.size >= 12 && text(0, 4) == "RIFF" && text(8, 4) == "WAVE" && u32(4) + 8 <= bytes.size)
        var position = 12; var validFormat = false; var pcm: ShortArray? = null
        while (position + 8 <= bytes.size) {
            val tag = text(position, 4); val sizeLong = u32(position + 4)
            require(sizeLong <= bytes.size - position - 8)
            val size = sizeLong.toInt(); val data = position + 8
            if (tag == "fmt ") {
                require(size >= 16 && u16(data) == 1 && u16(data + 2) == 1 && u32(data + 4) == 16_000L && u16(data + 12) == 2 && u16(data + 14) == 16)
                validFormat = true
            } else if (tag == "data") {
                require(size in 2..960_000 && size % 2 == 0 && pcm == null)
                pcm = ShortArray(size / 2) { u16(data + it * 2).toShort() }
            }
            position = data + size + size % 2
        }
        require(validFormat && pcm != null) { "Expected 16 kHz mono signed PCM16 synthetic WAV." }
        return pcm
    }
}
