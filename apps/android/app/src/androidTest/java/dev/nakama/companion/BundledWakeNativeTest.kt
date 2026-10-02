package dev.nakama.companion

import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest

/** Real KWS -> VAD -> Whisper handover, using checked offline files and no microphone/actions. */
@RunWith(AndroidJUnit4::class)
class BundledWakeNativeTest {
    private val assets get() = InstrumentationRegistry.getInstrumentation().context.assets
    private fun emulatorOnly() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
    }
    private fun fixtures(folder: String = "speech-fixtures"): List<JSONObject> {
        val manifest = JSONArray(assets.open("$folder/manifest.json").bufferedReader().use { it.readText() })
        return (0 until manifest.length()).map(manifest::getJSONObject)
    }
    private fun pcm(fixture: JSONObject, folder: String = "speech-fixtures"): ShortArray {
        val file = fixture.getString("file")
        require(file.matches(Regex("[a-z0-9-]+\\.wav")))
        val bytes = assets.open("$folder/$file").use { it.readBytes() }
        require(bytes.size in 44..2 * 1024 * 1024)
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        assertEquals("Synthetic fixture checksum: $file", fixture.getString("sha256"), sha)
        return try { wavPcm(bytes) } finally { bytes.fill(0) }
    }
    private fun decode(samples: ShortArray, chunkSize: Int = 1600): List<String> {
        val decoder = BundledWakeDecoders.open(InstrumentationRegistry.getInstrumentation().targetContext)
        val chunk = ShortArray(chunkSize)
        val words = mutableListOf<String>()
        val began = SystemClock.elapsedRealtime()
        fun feed(count: Int) {
            if (decoder.accept(chunk, count)) decoder.result().trim().takeIf(String::isNotBlank)?.let(words::add)
            chunk.fill(0)
        }
        try {
            var offset = 0
            while (offset < samples.size) {
                val count = minOf(chunk.size, samples.size - offset)
                samples.copyInto(chunk, 0, offset, offset + count)
                feed(count); offset += count
            }
            repeat((16_000 + chunkSize - 1) / chunkSize) { feed(chunk.size) }
            decoder.finish().trim().takeIf(String::isNotBlank)?.let(words::add)
            Log.i("NakamaSyntheticHandover", "chunk=$chunkSize ms=${SystemClock.elapsedRealtime() - began} => $words")
            assertTrue("Every command must retain exact KWS authority: $words", words.all { FoundationPolicy.wakeCommand(it) != null })
            return words
        } finally { chunk.fill(0); decoder.close() }
    }
    private fun commands(words: List<String>) = words.mapNotNull(FoundationPolicy::wakeCommand).filter(String::isNotBlank)
    private fun checkCommand(label: String, expected: LocalClockCommand?, words: List<String>, failures: MutableList<String>) {
        val requests = commands(words)
        if (requests.size != 1 || LocalClockCommands.parse(requests.singleOrNull().orEmpty()) != expected) {
            failures += "$label: expected $expected, authorized results $words"
        }
    }

    @Test fun sameBreathCommandsRetainTheirBeginningAndBareWakeNeverBecomesARequest() {
        emulatorOnly()
        val positives = fixtures().filter { it.getBoolean("expectedWake") }
        assertEquals(8, positives.size)
        val failures = mutableListOf<String>()
        for (fixture in positives) {
            val samples = pcm(fixture)
            val words = try { decode(samples) } finally { samples.fill(0) }
            val label = fixture.getString("file")
            val expected = LocalClockCommands.parse(fixture.getString("phrase"))
            if (expected == null) {
                if (words.size != 1 || commands(words).isNotEmpty()) failures += "$label: bare wake must emit just one wake event, got $words"
            } else checkCommand(label, expected, words, failures)
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun bareWakeThenSeparatelySpokenRequestUsesTheSameAuthorizedWindow() {
        emulatorOnly()
        val corpus = fixtures()
        val failures = mutableListOf<String>()
        for (voice in listOf("hazel-gb", "zira-us")) {
            for (kind in listOf("time", "timer")) {
                val wake = pcm(corpus.single { it.getString("file") == "$voice-hey-wake.wav" })
                val requestFixture = corpus.single { it.getString("file") == "$voice-talk-$kind.wav" }
                val request = pcm(requestFixture)
                val joined = ShortArray(wake.size + 32_000 + request.size)
                wake.copyInto(joined); request.copyInto(joined, wake.size + 32_000)
                try {
                    checkCommand("$voice separate $kind", LocalClockCommands.parse(requestFixture.getString("phrase")), decode(joined), failures)
                } finally { wake.fill(0); request.fill(0); joined.fill(0) }
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun shortSameBreathRequestsAndChangedSpeechRateRemainWholeCommands() {
        emulatorOnly()
        val folder = "speech-fixtures/wake-handover"
        val corpus = fixtures(folder)
        assertEquals(8, corpus.size)
        val failures = mutableListOf<String>()
        for ((index, fixture) in corpus.withIndex()) {
            val samples = pcm(fixture, folder)
            try {
                checkCommand(fixture.getString("file"), LocalClockCommands.parse(fixture.getString("expectedCommand")),
                    decode(samples, if (index % 2 == 0) 320 else 1600), failures)
            } finally { samples.fill(0) }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun longIdleOffsetAndDifferentReadSizesPreserveTheTimeRequest() {
        emulatorOnly()
        val fixture = fixtures().single { it.getString("file") == "hazel-gb-wake-time.wav" }
        val samples = pcm(fixture)
        val failures = mutableListOf<String>()
        try {
            for (chunk in listOf(320, 1600, 3200)) {
                val joined = ShortArray(12 * 16_000 + samples.size)
                samples.copyInto(joined, 12 * 16_000)
                try { checkCommand("12 seconds idle, chunk $chunk", LocalClockCommand.Time, decode(joined, chunk), failures) }
                finally { joined.fill(0) }
            }
        } finally { samples.fill(0) }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun ordinaryRequestsAndNearNamesNeverReachConversationDecoding() {
        emulatorOnly()
        val corpus = fixtures()
        for (fixture in corpus.filter { !it.getBoolean("expectedWake") }) {
            val samples = pcm(fixture)
            try { assertTrue("No wake authority for ${fixture.getString("file")}", decode(samples).isEmpty()) }
            finally { samples.fill(0) }
        }
    }

    private fun wavPcm(bytes: ByteArray): ShortArray {
        fun text(at: Int, count: Int) = String(bytes, at, count, Charsets.US_ASCII)
        fun u16(at: Int) = (bytes[at].toInt() and 255) or ((bytes[at + 1].toInt() and 255) shl 8)
        fun u32(at: Int): Long = (0..3).fold(0L) { total, n -> total or ((bytes[at + n].toLong() and 255L) shl (8 * n)) }
        require(bytes.size >= 12 && text(0, 4) == "RIFF" && text(8, 4) == "WAVE" && u32(4) + 8 <= bytes.size)
        var position = 12; var valid = false; var pcm: ShortArray? = null
        while (position + 8 <= bytes.size) {
            val tag = text(position, 4); val sizeLong = u32(position + 4)
            require(sizeLong <= bytes.size - position - 8)
            val size = sizeLong.toInt(); val data = position + 8
            if (tag == "fmt ") {
                require(size >= 16 && u16(data) == 1 && u16(data + 2) == 1 && u32(data + 4) == 16_000L && u16(data + 12) == 2 && u16(data + 14) == 16)
                valid = true
            } else if (tag == "data") {
                require(size in 2..960_000 && size % 2 == 0 && pcm == null)
                pcm = ShortArray(size / 2) { u16(data + it * 2).toShort() }
            }
            position = data + size + size % 2
        }
        require(valid && pcm != null) { "Expected 16 kHz mono signed PCM16 synthetic WAV." }
        return pcm
    }
}
