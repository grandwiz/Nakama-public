package dev.nakama.companion

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.IOException
import kotlin.concurrent.thread

/** Bounded nonblocking pipe writes; cancellation never waits on a recognizer that stopped reading. */
internal object PcmWritePolicy {
    fun write(size: Int, active: () -> Boolean, now: () -> Long, write: (Int, Int) -> Int, yield: () -> Unit): Boolean {
        var offset = 0
        val deadline = now() + 2_000
        while (offset < size && active()) {
            val written = write(offset, size - offset)
            require(written in 0..(size - offset)) { "Invalid PCM pipe write count" }
            if (written == 0) { if (now() >= deadline) throw IOException("Local recognizer stopped reading microphone input"); yield() }
            else offset += written
        }
        return offset == size
    }
}

/** Live PCM flows through a bounded OS pipe only. No file, recording, or transcript is saved. */
internal class LocalPcmSource(private val onFailure: () -> Unit) {
    companion object { const val SAMPLE_RATE = 16_000 }
    private val pipe = ParcelFileDescriptor.createPipe()
    val descriptor: ParcelFileDescriptor get() = pipe[0]
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var closed = false
    private var recorder: AudioRecord? = null
    init {
        try {
            val flags = Os.fcntlInt(pipe[1].fileDescriptor, OsConstants.F_GETFL, 0)
            Os.fcntlInt(pipe[1].fileDescriptor, OsConstants.F_SETFL, flags or OsConstants.O_NONBLOCK)
        } catch (failure: Exception) { pipe.forEach { runCatching { it.close() } }; throw failure }
    }
    @SuppressLint("MissingPermission") // User-started microphone FGS verifies RECORD_AUDIO before creation.
    fun start() {
        check(!closed)
        val buffer = maxOf(4_096, AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT))
        val input = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
            .setBufferSizeInBytes(buffer).build().also { recorder = it }
        check(input.state == AudioRecord.STATE_INITIALIZED) { "Android microphone could not initialize" }
        input.startRecording()
        check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Android microphone did not start" }
        thread(name = "Nakama local wake audio", isDaemon = true) {
            val bytes = ByteArray(4_096)
            try {
                while (!closed) {
                    val count = input.read(bytes, 0, bytes.size, AudioRecord.READ_BLOCKING)
                    if (closed) break
                    if (count < 0) throw IOException("Android microphone read failed")
                    if (count == 0) continue
                    PcmWritePolicy.write(count, { !closed }, SystemClock::elapsedRealtime, { offset, size ->
                        try { Os.write(pipe[1].fileDescriptor, bytes, offset, size) }
                        catch (error: ErrnoException) { if (error.errno == OsConstants.EAGAIN) 0 else throw error }
                    }, { Thread.sleep(10) })
                    bytes.fill(0)
                }
            } catch (_: Exception) { if (!closed) handler.post { if (!closed) onFailure() } }
            finally { bytes.fill(0) }
        }
    }
    fun close() {
        if (closed) return
        closed = true; handler.removeCallbacksAndMessages(null)
        // Nonblocking writes plus closing both descriptors ensure a stalled reader cannot hang Stop.
        pipe.forEach { runCatching { it.close() } }
        runCatching { recorder?.stop() }; runCatching { recorder?.release() }; recorder = null
    }
}
