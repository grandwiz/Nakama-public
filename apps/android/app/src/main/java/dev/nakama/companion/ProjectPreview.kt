package dev.nakama.companion

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.Base64

data class ProjectDocument(val name: String, val mime: String, val bytes: ByteArray, val hash: String)
data class DocumentExportReceipt(val name: String, val mime: String, val hash: String, val epoch: Long) {
    fun matches(document: ProjectDocument, currentEpoch: Long) = epoch == currentEpoch && name == document.name && mime == document.mime && hash == document.hash
}
object ProjectFilePolicy {
    const val MAX_BINARY = 1_363_148
    fun relative(path: String) = path.length <= 1200 && !path.startsWith('/') && !path.contains('\\') && !path.contains(Regex("[\\x00-\\x1f\\x7f]")) && path.split('/').none { it == "." || it == ".." }
    fun query(path: String): String { require(relative(path)); return URLEncoder.encode(path, "UTF-8").replace(".", "%2E") }
    fun name(value: String) = value.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\x00-\\x1f\\x7f]"), "").take(150).ifBlank { "Nakama document" }
    fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    fun binary(json: JSONObject): ProjectDocument {
        val encoded = json.getString("base64"); require(encoded.length <= 1_820_000) { "Preview is too large." }
        val bytes = Base64.getDecoder().decode(encoded); require(bytes.size in 1..MAX_BINARY && bytes.size == json.optInt("bytes")) { "Invalid preview size." }
        val mime = json.getString("mimeType")
        val valid = when (mime) {
            "application/pdf" -> bytes.take(5).toByteArray().contentEquals("%PDF-".toByteArray())
            "image/png" -> bytes.take(8).toByteArray().contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))
            "image/jpeg" -> bytes.size >= 3 && bytes[0] == (-1).toByte() && bytes[1] == (-40).toByte() && bytes[2] == (-1).toByte()
            else -> false
        }
        require(valid) { "Unsupported or invalid project preview." }
        val hash = hash(bytes); require(hash == json.optString("sha256").lowercase()) { "Preview checksum did not match." }
        return ProjectDocument(name(json.optString("fileName", json.optString("path"))), mime, bytes, hash)
    }
    fun text(path: String, text: String): ProjectDocument {
        val bytes = text.toByteArray(Charsets.UTF_8); require(bytes.size <= 1_048_576 && !text.contains('\u0000')) { "Select a text file no larger than 1 MB." }
        return ProjectDocument(name(path), "text/plain", bytes, hash(bytes))
    }
    fun decodeImage(bytes: ByteArray): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 1..8192 && bounds.outHeight in 1..8192 && bounds.outWidth.toLong() * bounds.outHeight <= 16_000_000) { "Image dimensions exceed the phone preview limit." }
        val options = BitmapFactory.Options().apply { inSampleSize = (maxOf(bounds.outWidth, bounds.outHeight) / 1600).coerceAtLeast(1) }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: error("The image could not be decoded.")
    }
}

@Composable
fun ProjectPreview(document: ProjectDocument, allowed: Boolean, onDismiss: () -> Unit, reloadForExport: suspend () -> ProjectDocument) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    val currentAllowed by rememberUpdatedState(allowed)
    val currentDocument by rememberUpdatedState(document)
    var exportEpoch by remember { mutableLongStateOf(0L) }; var pendingExport by remember { mutableStateOf<DocumentExportReceipt?>(null) }
    var error by remember(document.hash) { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    var page by remember(document.hash) { mutableIntStateOf(0) }; var pages by remember { mutableIntStateOf(0) }
    var bitmap by remember(document.hash) { mutableStateOf<Bitmap?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(document.mime)) { destination ->
        val receipt = pendingExport; pendingExport = null
        if (destination != null && currentAllowed && receipt != null) scope.launch {
            busy = true; error = ""
            try {
                check(receipt.matches(currentDocument, exportEpoch)) { "This preview changed while choosing a destination. Save the current file again." }
                val fresh = reloadForExport()
                check(currentAllowed && receipt.matches(currentDocument, exportEpoch) && receipt.matches(fresh, exportEpoch)) { "Access or this file changed. Open a fresh preview before saving." }
                withContext(Dispatchers.IO) { check(currentAllowed && receipt.matches(currentDocument, exportEpoch)); context.contentResolver.openOutputStream(destination, "wt")?.use { it.write(fresh.bytes) } ?: error("Android could not open that destination.") }
            } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { error = failure.message.orEmpty() }
            finally { busy = false }
        }
    }
    LaunchedEffect(document.hash, page, allowed) {
        bitmap = null; error = ""
        if (!allowed || document.mime == "text/plain") return@LaunchedEffect
        try {
            val rendered = withContext(Dispatchers.IO) {
                if (document.mime.startsWith("image/")) ProjectFilePolicy.decodeImage(document.bytes) to 1
                else ProjectPdfRenderer.render(context, document.bytes, page)
            }
            if (currentAllowed) { bitmap = rendered.first; pages = rendered.second }
        } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { error = failure.message.orEmpty() }
    }
    if (!allowed) return
    AlertDialog(onDismissRequest = onDismiss, title = { Text(document.name) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${document.mime} · ${document.bytes.size} bytes", style = MaterialTheme.typography.labelSmall)
            if (busy) NakamaBusy(Modifier.fillMaxWidth())
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            if (document.mime == "text/plain") {
                val chunks = remember(document.hash) { document.bytes.toString(Charsets.UTF_8).chunked(1500) }
                SelectionContainer { LazyColumn(Modifier.heightIn(min = 160.dp, max = 400.dp)) { items(chunks.size) { Text(chunks[it], style = MaterialTheme.typography.bodySmall) } } }
            } else bitmap?.let { Image(it.asImageBitmap(), "Project document page", modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 400.dp), contentScale = ContentScale.Fit) }
                ?: Text(if (error.isBlank()) "Rendering preview…" else "No preview rendered.")
            if (document.mime == "application/pdf" && pages > 0) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(enabled = page > 0, onClick = { page-- }) { Text("Previous") }; Text("${page + 1}/$pages", Modifier.padding(top = 12.dp)); TextButton(enabled = page + 1 < pages, onClick = { page++ }) { Text("Next") }
            }
            Text("Preview stays in Nakama. Save a copy explicitly to keep it outside the app.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = { pendingExport = DocumentExportReceipt(document.name, document.mime, document.hash, ++exportEpoch); save.launch(document.name) }) { Text("Save a copy") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Close preview") } })
}
