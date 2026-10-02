package dev.nakama.companion

import android.app.Service
import android.content.*
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.*
import kotlinx.coroutines.*
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** PDF parsing has no app permissions, pairing vault access or network access. Only two temporary descriptors cross the boundary. */
class ProjectPdfService : Service() {
    private lateinit var worker: HandlerThread
    private lateinit var receiver: Messenger
    override fun onCreate() {
        super.onCreate(); worker = HandlerThread("project-pdf").apply { start() }
        receiver = Messenger(object : Handler(worker.looper) {
            override fun handleMessage(message: Message) {
                val source = message.data.getParcelable("source", ParcelFileDescriptor::class.java)
                val destination = message.data.getParcelable("destination", ParcelFileDescriptor::class.java)
                val result = Message.obtain().apply { what = 1 }
                try {
                    check(source != null && destination != null && source.statSize in 1..ProjectFilePolicy.MAX_BINARY.toLong())
                    PdfRenderer(source).use { renderer ->
                        val count = renderer.pageCount; check(count in 1..500)
                        renderer.openPage(message.arg1.coerceIn(0, count - 1)).use { page ->
                            val scale = minOf(2f, 1600f / maxOf(page.width, page.height).coerceAtLeast(1))
                            val bitmap = Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                            try {
                                bitmap.eraseColor(android.graphics.Color.WHITE); page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                ParcelFileDescriptor.AutoCloseOutputStream(destination).use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
                                result.arg1 = count
                            } finally { bitmap.recycle() }
                        }
                    }
                } catch (_: Exception) { result.arg1 = -1 }
                finally { runCatching { source?.close() }; runCatching { destination?.close() } }
                runCatching { message.replyTo?.send(result) }
            }
        })
    }
    override fun onBind(intent: Intent) = receiver.binder
    override fun onDestroy() { worker.quitSafely(); super.onDestroy() }
}

object ProjectPdfRenderer {
    suspend fun render(context: Context, bytes: ByteArray, page: Int): Pair<Bitmap, Int> = withContext(Dispatchers.IO) {
        require(bytes.size in 1..ProjectFilePolicy.MAX_BINARY)
        val input = File.createTempFile("nakama-pdf-input-", ".tmp", context.cacheDir)
        val output = File.createTempFile("nakama-pdf-output-", ".tmp", context.cacheDir)
        try {
            input.writeBytes(bytes)
            ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY).use { source ->
                ParcelFileDescriptor.open(output, ParcelFileDescriptor.MODE_READ_WRITE).use { destination ->
                    // The kernel keeps these open descriptors alive; no preview remains after a crash.
                    check(input.delete() && output.delete())
                    val count = withTimeout(15_000) { isolated(context, source, destination, page) }
                    ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(destination.fileDescriptor)).use { stream ->
                        stream.channel.position(0)
                        val rendered = stream.readNBytes(12_000_001); check(rendered.size <= 12_000_000)
                        ProjectFilePolicy.decodeImage(rendered) to count
                    }
                }
            }
        } finally { input.delete(); output.delete() }
    }

    private suspend fun isolated(context: Context, source: ParcelFileDescriptor, destination: ParcelFileDescriptor, page: Int): Int = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { continuation ->
            var bound = false; var finished = false
            lateinit var connection: ServiceConnection
            fun close() { if (!finished) { finished = true; if (bound) runCatching { context.unbindService(connection) } } }
            val reply = Messenger(object : Handler(Looper.getMainLooper()) {
                override fun handleMessage(message: Message) {
                    close()
                    if (continuation.isActive) if (message.arg1 in 1..500) continuation.resume(message.arg1) else continuation.resumeWithException(IllegalArgumentException("This PDF could not be rendered securely."))
                }
            })
            connection = object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                    if (!continuation.isActive) { close(); return }
                    try { Messenger(binder).send(Message.obtain().apply { what = 1; arg1 = page; replyTo = reply; data = Bundle().apply { putParcelable("source", source); putParcelable("destination", destination) } }) }
                    catch (error: Exception) { close(); if (continuation.isActive) continuation.resumeWithException(error) }
                }
                override fun onServiceDisconnected(name: ComponentName) { close(); if (continuation.isActive) continuation.resumeWithException(IllegalStateException("PDF renderer stopped.")) }
                override fun onNullBinding(name: ComponentName) { onServiceDisconnected(name) }
            }
            bound = context.bindService(Intent(context, ProjectPdfService::class.java), connection, Context.BIND_AUTO_CREATE)
            if (!bound) { close(); continuation.resumeWithException(IllegalStateException("Android could not start the isolated PDF renderer.")) }
            continuation.invokeOnCancellation { Handler(Looper.getMainLooper()).post { close() } }
        }
    }
}
