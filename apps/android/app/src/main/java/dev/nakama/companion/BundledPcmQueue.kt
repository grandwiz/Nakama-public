package dev.nakama.companion

import java.util.ArrayDeque

internal class BundledCaptureOverflow : IllegalStateException("Microphone capture could not keep up. Please repeat your request.")

/** The producer never waits for decoding. Overflow invalidates the whole request, never drops frames. */
internal class BundledPcmQueue(private val capacity: Int = 320_000) {
    private val lock = java.lang.Object()
    private val chunks = ArrayDeque<ShortArray>()
    private var samples = 0
    private var offset = 0
    private var stopped = false
    private var failure: Exception? = null
    fun offer(input: ShortArray, count: Int): Boolean = synchronized(lock) {
        require(count in 0..input.size)
        if (stopped || failure != null) return false
        if (samples + count > capacity) {
            failure = BundledCaptureOverflow(); clear(); lock.notifyAll(); return false
        }
        if (count > 0) { chunks.addLast(input.copyOf(count)); samples += count; lock.notifyAll() }
        true
    }
    fun fail(error: Exception) = synchronized(lock) {
        if (!stopped && failure == null) failure = error
        clear(); lock.notifyAll()
    }
    fun checkHealthy() { synchronized(lock) { failure?.let { throw it } } }
    fun read(output: ShortArray): Int = synchronized(lock) {
        if (chunks.isEmpty() && !stopped && failure == null) lock.wait(100)
        failure?.let { throw it }
        if (stopped || chunks.isEmpty()) return 0
        var written = 0
        while (written < output.size && chunks.isNotEmpty()) {
            val chunk = chunks.first()
            val count = minOf(output.size - written, chunk.size - offset)
            chunk.copyInto(output, written, offset, offset + count)
            chunk.fill(0, offset, offset + count)
            written += count; offset += count; samples -= count
            if (offset == chunk.size) { chunks.removeFirst(); offset = 0 }
        }
        written
    }
    fun stop() = synchronized(lock) { stopped = true; clear(); lock.notifyAll() }
    private fun clear() { chunks.forEach { it.fill(0) }; chunks.clear(); samples = 0; offset = 0 }
}

/** One capture thread owns reads/release; a decoder thread consumes a bounded in-memory queue. */
internal class BufferedBundledAudio(
    private val source: BundledAudio,
    private val launch: (() -> Unit) -> Unit,
    capacity: Int = 320_000,
) : BundledAudio {
    private val queue = BundledPcmQueue(capacity)
    @Volatile private var stopped = false
    @Volatile private var launched = false
    override fun start() {
        if (stopped) return
        source.start()
        if (stopped) { source.close(); return }
        launched = true
        try { launch {
            val buffer = ShortArray(1_600)
            try {
                while (!stopped) {
                    val count = source.read(buffer)
                    if (stopped) break
                    check(count in 0..buffer.size) { "Android microphone read failed." }
                    if (count == 0) Thread.sleep(5)
                    else if (!queue.offer(buffer, count)) break
                    buffer.fill(0)
                }
            } catch (error: Exception) { if (!stopped) queue.fail(error) }
            finally { buffer.fill(0); source.close() }
        } } catch (error: Exception) { launched = false; queue.fail(error); source.close(); throw error }
    }
    override fun read(samples: ShortArray) = queue.read(samples)
    override fun checkHealthy() = queue.checkHealthy()
    override fun stop() { stopped = true; queue.stop(); source.stop() }
    override fun close() { stop(); if (!launched) source.close() }
}
