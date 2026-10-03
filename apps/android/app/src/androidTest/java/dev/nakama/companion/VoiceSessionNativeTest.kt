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

/** Packaged stop keyword and request networks; only checked synthetic WAVs, no microphone. */
@RunWith(AndroidJUnit4::class)
class VoiceSessionNativeTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun guard() = check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_"))
    private fun fixtures() = JSONArray(instrumentation.context.assets.open("speech-fixtures/voice-session/manifest.json").bufferedReader().use { it.readText() })
    private fun samples(index: Int): ShortArray {
        val row = fixtures().getJSONObject(index); val bytes = instrumentation.context.assets.open("speech-fixtures/voice-session/${row.getString("file")}").use { it.readBytes() }
        assertEquals(row.getString("sha256"), AlarmSoundPolicy.sha256(bytes))
        return wavPcm(bytes).also { bytes.fill(0) }
    }
    private fun detect(pcm: ShortArray): Pair<Boolean, Long> {
        val prepareStart = SystemClock.elapsedRealtime(); BundledNativeDecoders.prepareStop(instrumentation.targetContext); Log.i("NakamaStopPrepare", "PrepareMs=${SystemClock.elapsedRealtime() - prepareStart}")
        val detector = BundledStopDecoder({ BundledKeywordSpotters.open(instrumentation.targetContext, stopOnly = true) }, { pcm -> val start = SystemClock.elapsedRealtime(); BundledNativeDecoders.confirmStop(instrumentation.targetContext, pcm).also { Log.i("NakamaStopConfirmation", "Synthetic stop-word transcript: $it; confirmMs=${SystemClock.elapsedRealtime() - start}") } })
        val chunk = ShortArray(1600); var first = -1L
        try { for (offset in 0 until pcm.size + 16_000 step chunk.size) {
            chunk.fill(0); val size = minOf(chunk.size, (pcm.size - offset).coerceAtLeast(0)); if (size > 0) pcm.copyInto(chunk, 0, offset, offset + size)
            val hit = if (detector.accept(chunk, chunk.size)) detector.result() else ""
            if (hit.isNotBlank()) { assertEquals("Nakama stop", hit); if (first < 0) first = (offset + chunk.size) * 1000L / 16_000 }
        }; return (first >= 0) to first } finally { detector.close(); chunk.fill(0) }
    }
    @Test fun dedicatedStopRecognizesExactPhrasesAndRejectsNearMatchesAndReplyEcho() {
        guard(); if (InstrumentationRegistry.getArguments().getString("stop_calibrate") == "true") { calibrate(); return }; val rows = fixtures(); val failures = mutableListOf<String>()
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index); val pcm = samples(index)
            val started = SystemClock.elapsedRealtime(); val hit = try { detect(pcm) } finally { pcm.fill(0) }
            Log.i("NakamaStopFixture", "${row.getString("file")}: expected=${row.getBoolean("expectedStop")}, hit=${hit.first}, audioMs=${hit.second}, computeMs=${SystemClock.elapsedRealtime() - started}")
            if (row.getBoolean("expectedStop") != hit.first) failures += row.getString("file") + "=" + hit
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }
    @Test fun alarmToneNoiseAndSilenceCannotTriggerStop() {
        guard(); val random = java.util.Random(88L)
        for (pcm in listOf(ShortArray(48_000), ShortArray(48_000) { (random.nextInt(4001)-2000).toShort() }, ShortArray(48_000) { (6000 * kotlin.math.sin(2 * Math.PI * 800 * it / 16_000)).toInt().toShort() })) {
            try { assertFalse(detect(pcm).first) } finally { pcm.fill(0) }
        }
    }
    @Test fun authorizedFollowUpUsesWhisperWithoutAnotherKeyword() {
        guard(); val rows = fixtures()
        for (index in 0 until rows.length()) if (rows.getJSONObject(index).getString("file").endsWith("-follow.wav")) {
            val pcm = samples(index); val decoder = BundledNativeDecoders.open(instrumentation.targetContext); val chunk = ShortArray(1600); var result = ""
            try {
                for (offset in 0 until pcm.size + 16_000 step chunk.size) {
                    chunk.fill(0); val count = minOf(chunk.size, (pcm.size-offset).coerceAtLeast(0)); if (count > 0) pcm.copyInto(chunk, 0, offset, offset+count)
                    if (decoder.accept(chunk, chunk.size)) { result = decoder.result(); if (result.isNotBlank()) break }
                }
                assertTrue("Follow-up transcribed as: $result", LocalClockCommands.parse(result) is LocalClockCommand.CreateTimer)
            } finally { decoder.close(); chunk.fill(0); pcm.fill(0) }
        }
    }
    private fun calibrate() {
        val folder = java.io.File(BundledSpeechModel.prepare(instrumentation.targetContext), "wake")
        val keywords = java.io.File(instrumentation.targetContext.cacheDir, "synthetic-stop-calibration.txt")
        try {
            for (threshold in listOf(0.4f, 0.5f, 0.6f, 0.7f, 0.8f)) {
                keywords.writeText("▁NA K A MA ▁ST O P #$threshold @NAKAMA_STOP\n")
                fun file(name: String) = java.io.File(folder, name).absolutePath
                val model = com.k2fsa.sherpa.onnx.KeywordSpotter(config = com.k2fsa.sherpa.onnx.KeywordSpotterConfig(
                    featConfig = com.k2fsa.sherpa.onnx.FeatureConfig(sampleRate = 16_000, featureDim = 80),
                    modelConfig = com.k2fsa.sherpa.onnx.OnlineModelConfig(transducer = com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig(encoder = file("encoder-epoch-12-avg-2-chunk-16-left-64.onnx"), decoder = file("decoder-epoch-12-avg-2-chunk-16-left-64.onnx"), joiner = file("joiner-epoch-12-avg-2-chunk-16-left-64.onnx")), tokens = file("tokens.txt"), numThreads = 1, provider = "cpu", modelType = "zipformer2"),
                    maxActivePaths = 8, keywordsFile = keywords.absolutePath, keywordsScore = 1.5f, keywordsThreshold = threshold, numTrailingBlanks = 2))
                try {
                    val rows = fixtures(); var hits = 0; var falseHits = 0; var total = 0
                    for (index in 0 until rows.length()) {
                        val row = rows.getJSONObject(index); val pcm = samples(index); val stream = model.createStream(); var found = false
                        try {
                            for (offset in 0 until pcm.size + 16_000 step 1600) {
                                val floats = FloatArray(1600) { if (offset + it < pcm.size) pcm[offset + it] / 32768f else 0f }
                                stream.acceptWaveform(floats, 16_000); floats.fill(0f)
                                while (model.isReady(stream)) { model.decode(stream); if (model.getResult(stream).keyword == "NAKAMA_STOP") found = true }
                            }
                        } finally { stream.release(); pcm.fill(0) }
                        if (row.getBoolean("expectedStop")) { total++; if (found) hits++ } else if (found) falseHits++
                        Log.i("NakamaStopCalibration", "$threshold ${row.getString("file")} = $found")
                    }
                    Log.i("NakamaStopCalibration", "SUMMARY threshold=$threshold positive=$hits/$total false=$falseHits")
                } finally { model.release() }
            }
        } finally { keywords.delete() }
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
