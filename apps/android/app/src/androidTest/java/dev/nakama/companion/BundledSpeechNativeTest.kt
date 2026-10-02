package dev.nakama.companion

import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest

/** Production VAD + command ASR, synthetic PCM only: no microphone, timers, apps or host calls. */
@RunWith(AndroidJUnit4::class)
class BundledSpeechNativeTest {
    private var memoryReported = false
    private fun emulatorOnly() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
    }
    private fun decode(samples: ShortArray, chunkSize: Int = 1600): List<String> {
        val began = SystemClock.elapsedRealtime()
        val decoder = BundledNativeDecoders.open(InstrumentationRegistry.getInstrumentation().targetContext)
        val prepared = SystemClock.elapsedRealtime()
        val words = mutableListOf<String>()
        val chunk = ShortArray(chunkSize)
        var decodeMillis = 0L
        fun result() {
            val start = SystemClock.elapsedRealtime()
            val text = decoder.result().trim()
            decodeMillis += SystemClock.elapsedRealtime() - start
            if (text.isNotBlank()) words += text
            if (!memoryReported && text.isNotBlank()) {
                memoryReported = true
                Log.i("NakamaSyntheticSpeech", "MEMORY pssKb=" + android.os.Debug.getPss() + " nativeHeapBytes=" + android.os.Debug.getNativeHeapAllocatedSize() + " modelLoadMs=" + BundledNativeDecoders.modelLoadMillis)
            }
        }
        try {
            var offset = 0
            while (offset < samples.size) {
                val count = minOf(chunk.size, samples.size - offset)
                samples.copyInto(chunk, 0, offset, offset + count)
                if (decoder.accept(chunk, count)) result()
                chunk.fill(0); offset += count
            }
            val tail = ShortArray(1600)
            repeat(10) { if (decoder.accept(tail, tail.size)) result() }
            val start = SystemClock.elapsedRealtime()
            decoder.finish().trim().takeIf(String::isNotBlank)?.let(words::add)
            decodeMillis += SystemClock.elapsedRealtime() - start
            Log.i("NakamaSyntheticSpeech", "TIMING prepareMs=${prepared - began} inferenceMs=$decodeMillis totalMs=${SystemClock.elapsedRealtime() - began}")
            return words
        } finally { chunk.fill(0); samples.fill(0); decoder.close() }
    }
    @Test fun packagedVadRejectsSilenceDcNoiseAndToneWithoutInventingRequests() {
        emulatorOnly()
        assertTrue(BundledSpeechRecognition.available(InstrumentationRegistry.getInstrumentation().targetContext))
        val random = java.util.Random(7321L)
        val examples = linkedMapOf(
            "silence" to ShortArray(48_000),
            "steady DC" to ShortArray(48_000) { 2000 },
            "quiet noise" to ShortArray(48_000) { (random.nextInt(65) - 32).toShort() },
            "moderate hiss" to ShortArray(48_000) { (random.nextInt(4001) - 2000).toShort() },
            "440 Hz tone" to ShortArray(48_000) { (5000 * kotlin.math.sin(2 * Math.PI * 440 * it / 16_000)).toInt().toShort() },
        )
        for ((name, samples) in examples) assertTrue("$name must not fabricate words.", decode(samples).isEmpty())
    }
    @Test fun britishCommandsRetainActualTimerTimeAndAppSemantics() {
        emulatorOnly()
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val manifest = JSONArray(assets.open("command-fixtures/manifest.json").bufferedReader().use { it.readText() })
        assertEquals("Three British synthetic voices, 24 phrases each.", 72, manifest.length())
        val failures = mutableListOf<String>()
        var timers = 0; var apps = 0; var times = 0; var negatives = 0; var namedExact = 0; var namedTotal = 0; var greetings = 0; var dates = 0
        for (index in 0 until manifest.length()) {
            val fixture = manifest.getJSONObject(index)
            val file = fixture.getString("file")
            require(file.matches(Regex("[a-z0-9-]+\\.wav")))
            val bytes = assets.open("command-fixtures/$file").use { it.readBytes() }
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
            assertEquals("Synthetic fixture checksum: $file", fixture.getString("sha256"), hash)
            val transcript = decode(wavPcm(bytes)).joinToString(" ").trim()
            val phrase = fixture.getString("phrase")
            val kind = fixture.getString("kind")
            Log.i("NakamaSyntheticSpeech", "$file => $transcript")
            val local = LocalClockCommands.parse(transcript) // Raw production input, no test-only normalizer.
            when {
                kind == "timer" && !file.endsWith("timertea.wav") -> {
                    timers++
                    val expected = LocalClockCommand.CreateTimer(fixture.getString("value").toLong())
                    if (local != expected) failures += "$file expected $expected, got $local from '$transcript'"
                }
                kind == "time" -> {
                    times++
                    if (local != LocalClockCommand.Time) failures += "$file did not recognize time: '$transcript'"
                }
                kind == "greeting" -> {
                    greetings++
                    if (local != LocalClockCommand.Greeting) failures += "$file did not recognize greeting: '$transcript'"
                }
                kind == "date" -> {
                    dates++
                    if (local != LocalClockCommand.Date) failures += "$file did not recognize date: '$transcript'"
                }
                kind == "app" -> {
                    apps++
                    if (!transcript.trimEnd('.', '!', '?').equals(phrase.trimEnd('.', '!', '?'), true))
                        failures += "$file lost the requested app: '$transcript'"
                }
                kind == "remote" -> {
                    val expected = DeviceCommandRouting.parse(phrase)
                    val actual = DeviceCommandRouting.parse(transcript)
                    if (actual?.appName?.lowercase() != expected?.appName?.lowercase() ||
                        actual?.targetName?.lowercase() != expected?.targetName?.lowercase() || actual?.command != expected?.command)
                        failures += "$file lost the explicit target: '$transcript'"
                }
                kind == "negative" -> {
                    negatives++
                    if (transcript.isBlank() || local != null || PhoneCommandParser.parse(transcript) != null ||
                        NavigationPolicy.parse(transcript) != null || DeviceCommandRouting.parse(transcript) != null)
                        failures += "$file produced a command or no transcript: '$transcript'"
                    if (fixture.getString("value") == "not" && !transcript.contains(Regex("\\bnot\\b", RegexOption.IGNORE_CASE)))
                        failures += "$file lost negation: '$transcript'"
                }
                kind == "control" || file.endsWith("timertea.wav") -> {
                    namedTotal++
                    if (local == LocalClockCommands.parse(phrase)) namedExact++
                    // Homophones are measured, never silently rewritten to another saved timer.
                    if (local is LocalClockCommand.CreateTimer && local.seconds != 180L)
                        failures += "$file produced the wrong duration: '$transcript'"
                }
                kind == "conversation" -> {
                    val errorRate = wordErrorRate(phrase, transcript)
                    Log.i("NakamaSyntheticSpeech", "$file normalizedWER=$errorRate")
                    if (errorRate > 0.2) failures += "$file changed too much of the conversational request (WER=$errorRate): '$transcript'"
                }
            }
        }
        Log.i("NakamaSyntheticSpeech", "STRICT core timers=$timers time=$times apps=$apps negatives=$negatives; MEASURED named timer exact=$namedExact/$namedTotal")
        assertEquals(15, timers); assertEquals(3, times); assertEquals(12, apps); assertEquals(12, negatives); assertEquals(3, greetings); assertEquals(3, dates)
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }
    @Test fun timerCommandSurvivesDifferentMicrophoneReadChunkSizes() {
        emulatorOnly()
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("command-fixtures/hazel-timer10.wav").use { it.readBytes() }
        val pcm = wavPcm(bytes)
        try {
            for (size in listOf(512, 1600, 6400)) {
                val text = decode(pcm.copyOf(), size).joinToString(" ")
                assertEquals("$size samples per read: $text", LocalClockCommand.CreateTimer(600), LocalClockCommands.parse(text))
            }
        } finally { pcm.fill(0) }
    }
    /** A transcript quality metric only; action assertions above always use raw production input. */
    private fun wordErrorRate(expected: String, actual: String): Double {
        fun words(value: String) = value.lowercase().replace(Regex("[^a-z0-9 ]"), "").split(Regex("\\s+")).filter(String::isNotBlank)
        val source = words(expected); val result = words(actual)
        var previous = IntArray(result.size + 1) { it }
        for ((index, word) in source.withIndex()) {
            val next = IntArray(result.size + 1); next[0] = index + 1
            for (column in result.indices) next[column + 1] = minOf(next[column] + 1, previous[column + 1] + 1, previous[column] + if (word == result[column]) 0 else 1)
            previous = next
        }
        return previous.last().toDouble() / maxOf(1, source.size)
    }
    private fun wavPcm(bytes: ByteArray): ShortArray {
        fun text(at: Int, count: Int) = String(bytes, at, count, Charsets.US_ASCII)
        fun u16(at: Int) = (bytes[at].toInt() and 255) or ((bytes[at + 1].toInt() and 255) shl 8)
        fun u32(at: Int): Long = (0..3).fold(0L) { total, n -> total or ((bytes[at + n].toLong() and 255L) shl (8 * n)) }
        require(bytes.size >= 12 && text(0, 4) == "RIFF" && text(8, 4) == "WAVE")
        require(u32(4) + 8 <= bytes.size)
        var position = 12
        var validFormat = false
        var pcm: ShortArray? = null
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
