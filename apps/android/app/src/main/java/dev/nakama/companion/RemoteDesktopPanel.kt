package dev.nakama.companion

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

data class RemotePoint(val x: Double, val y: Double)
object RemotePointer {
    fun point(x: Float, y: Float, boxWidth: Int, boxHeight: Int, imageWidth: Int, imageHeight: Int): RemotePoint? {
        if (!x.isFinite() || !y.isFinite() || boxWidth <= 0 || boxHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null
        val scale = minOf(boxWidth.toFloat() / imageWidth, boxHeight.toFloat() / imageHeight)
        val width = imageWidth * scale; val height = imageHeight * scale
        val left = (boxWidth - width) / 2; val top = (boxHeight - height) / 2
        if (x < left || y < top || x >= left + width || y >= top + height) return null
        return RemotePoint(((x - left) / width).toDouble(), ((y - top) / height).toDouble())
    }
}

@Composable
fun RemoteDesktopPanel(request: suspend (String, String, JSONObject?) -> JSONObject, voiceCommand: Pair<Long, String>, voiceConsumed: () -> Unit) {
    val scope = rememberCoroutineScope()
    val activity = LocalActivity.current as? ComponentActivity ?: return
    var active by remember { mutableStateOf(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    var mounted by remember { mutableStateOf(true) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var status by remember { mutableStateOf(JSONObject()) }
    var session by remember { mutableStateOf<JSONObject?>(null) }
    var monitor by remember { mutableStateOf("") }
    var frame by remember { mutableStateOf<JSONObject?>(null) }
    var bitmap by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    var error by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var clickKind by remember { mutableStateOf("tap") }
    var dragging by remember { mutableStateOf(false) }
    val frameMutex = remember { Mutex() }
    val latestRequest by rememberUpdatedState(request)
    val latestSession by rememberUpdatedState(session)
    fun stop() {
        val id = session?.optString("id"); session = null; frame = null; bitmap = null; typed = ""
        if (!id.isNullOrBlank()) scope.launch { runCatching { request("POST", "/api/remote-desktop/stop", JSONObject().put("sessionId", id)) }.onFailure { error = "Disconnected locally. PC session will expire if its stop acknowledgement is unavailable." } }
    }
    suspend fun refresh() { status = request("GET", "/api/remote-desktop/status", null); if (monitor.isBlank()) monitor = status.objects("monitors").firstOrNull()?.optString("id").orEmpty() }
    fun start() {
        if (pending || !active) return
        pending = true; error = ""
        scope.launch { withContext(NonCancellable) { try { val response = request("POST", "/api/remote-desktop/start", JSONObject().apply { if (monitor.isNotBlank()) put("monitorId", monitor) }); if (active && mounted) { status = response; session = response.optJSONObject("session"); monitor = session?.optString("monitorId").orEmpty().ifBlank { monitor } } else response.optJSONObject("session")?.optString("id")?.let { request("POST", "/api/remote-desktop/stop", JSONObject().put("sessionId", it)) } } catch (failure: Exception) { error = failure.message.orEmpty() } finally { pending = false } } }
    }
    fun input(body: JSONObject) {
        val snapshot = frame ?: return
        val id = session?.optString("id") ?: return
        if (pending || !active) return
        pending = true; error = ""
        scope.launch { try { frameMutex.withLock {
            if (session?.optString("id") != id || !active) return@withLock
            check(snapshot.optString("frameId") == frame?.optString("frameId")) { "The PC image refreshed. Tap the current image again." }
            body.put("sessionId", id).put("frameId", snapshot.optString("frameId"))
            request("POST", "/api/remote-desktop/input", body); frame = null; typed = ""
        } } catch (failure: Exception) { frame = null; error = failure.message.orEmpty() } finally { pending = false } }
    }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) { active = false; stop() }
            else if (event == Lifecycle.Event.ON_RESUME) active = true
        }
        activity.lifecycle.addObserver(observer)
        onDispose {
            mounted = false
            activity.lifecycle.removeObserver(observer)
            val id = latestSession?.optString("id")
            if (!id.isNullOrBlank()) CoroutineScope(Dispatchers.Main).launch { runCatching { latestRequest("POST", "/api/remote-desktop/stop", JSONObject().put("sessionId", id)) } }
        }
    }
    LaunchedEffect(Unit) { runCatching { refresh() }.onFailure { error = it.message.orEmpty() } }
    LaunchedEffect(session?.optString("id")) { while (session != null) { now = System.currentTimeMillis(); delay(1000) } }
    LaunchedEffect(session?.optString("id"), monitor, active) {
        frame = null; bitmap = null
        val id = session?.optString("id") ?: return@LaunchedEffect
        if (!active) return@LaunchedEffect
        while (isActive) {
            try {
                if (pending || dragging) { delay(300); continue }
                frameMutex.withLock {
                val next = request("POST", "/api/remote-desktop/frame", JSONObject().put("sessionId", id).put("monitorId", monitor))
                val decoded = withContext(Dispatchers.Default) {
                    val data = next.getString("image"); require(data.startsWith("data:image/jpeg;base64,") && data.length < 1_900_000)
                    val bytes = Base64.decode(data.substringAfter(','), Base64.DEFAULT)
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    require(bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096 && bounds.outWidth.toLong() * bounds.outHeight <= 8_000_000)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("Invalid PC image")
                }
                if (active && session?.optString("id") == id && monitor == next.optString("monitorId")) { frame = next; bitmap = decoded }
                }
            } catch (failure: CancellationException) { throw failure }
            catch (failure: Exception) { error = failure.message.orEmpty(); stop(); break }
            delay(700)
        }
    }
    LaunchedEffect(voiceCommand) {
        val command = voiceCommand.second
        if (command.isBlank()) return@LaunchedEffect
        if (command == "stop") stop()
        else if (command == "connect") { if (status.objects("monitors").isEmpty()) runCatching { refresh() }; start() }
        else if (command.startsWith("input:")) {
            val value = runCatching { JSONObject(command.removePrefix("input:")) }.getOrNull()
            if (value != null && session != null && frame != null) {
                val body = JSONObject().put("kind", value.optString("kind"))
                when (value.optString("kind")) { "text" -> body.put("text", value.optString("value")); "key" -> body.put("key", value.optString("value")); "scroll" -> body.put("deltaY", value.optString("value").toIntOrNull() ?: 0).put("x", 0.5).put("y", 0.5) }
                input(body)
            } else error = "Connect to a current PC image before sending a spoken PC input."
        }
        else {
            if (status.objects("monitors").isEmpty()) runCatching { refresh() }
            val selection = command.removePrefix("monitor:")
            val monitors = status.objects("monitors")
            val chosen = selection.toIntOrNull()?.let { monitors.getOrNull(it - 1) } ?: monitors.firstOrNull { it.optString("name").equals(selection, true) || it.optString("id") == selection }
            if (chosen == null) error = "Choose a monitor shown below." else { monitor = chosen.optString("id"); frame = null; bitmap = null }
        }
        voiceConsumed()
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Your Windows desktop", style = MaterialTheme.typography.titleLarge)
        Text(status.optString("detail").ifBlank { "Enable remote desktop and this phone's permission on your PC. Direct touches control the selected monitor." }, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            status.objects("monitors").forEachIndexed { index, display -> FilterChip(selected = monitor == display.optString("id"), onClick = { monitor = display.optString("id"); frame = null; bitmap = null }, label = { Text("${index + 1}. ${display.optString("name")}") }) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !pending && session == null && status.optBoolean("permitted") && active, onClick = ::start) { Text("Connect to PC") }
            OutlinedButton(enabled = session != null, onClick = ::stop) { Text("Stop PC control") }
        }
        session?.let { current -> val seconds = runCatching { ((java.time.Instant.parse(current.optString("expiresAt")).toEpochMilli() - now).coerceAtLeast(0) + 999) / 1000 }.getOrDefault(0); Text("Visible PC session · ${seconds}s remaining", style = MaterialTheme.typography.labelSmall) }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        val image = bitmap
        if (image == null) Box(Modifier.weight(1f).fillMaxWidth()) { Text(if (session == null) "No screen is being received." else "Waiting for your PC frame…") }
        else Image(image.asImageBitmap(), "Live view of selected PC monitor", contentScale = ContentScale.Fit,
            modifier = Modifier.weight(1f).fillMaxWidth()
                .pointerInput(frame?.optString("frameId"), clickKind) {
                    detectTapGestures(onTap = { position -> RemotePointer.point(position.x, position.y, size.width, size.height, image.width, image.height)?.let { input(JSONObject().put("kind", clickKind).put("x", it.x).put("y", it.y)) } })
                }
                .pointerInput(session?.optString("id"), monitor) {
                    var first: Offset? = null; var last: Offset? = null; var dragFrame: String? = null
                    detectDragGestures(onDragStart = { dragging = true; dragFrame = frame?.optString("frameId"); first = it; last = it }, onDragCancel = { dragging = false; first = null; last = null; dragFrame = null }, onDragEnd = {
                        val from = first?.let { RemotePointer.point(it.x, it.y, size.width, size.height, image.width, image.height) }
                        val to = last?.let { RemotePointer.point(it.x, it.y, size.width, size.height, image.width, image.height) }
                        if (dragFrame != frame?.optString("frameId")) error = "The PC image changed during the drag. Try again on the current image."
                        else if (from != null && to != null) input(JSONObject().put("kind", "drag").put("x", from.x).put("y", from.y).put("endX", to.x).put("endY", to.y))
                        dragging = false; first = null; last = null
                    }, onDrag = { change, _ -> last = change.position; change.consume() })
                })
        if (session != null) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("tap" to "Click", "double_tap" to "Double", "right_click" to "Right").forEach { (kind, label) -> FilterChip(selected = clickKind == kind, onClick = { clickKind = kind }, label = { Text(label) }) }
                listOf("Escape", "Enter", "Tab").forEach { key -> OutlinedButton(enabled = !pending, onClick = { input(JSONObject().put("kind", "key").put("key", key)) }) { Text(key) } }
                listOf(-3 to "Scroll up", 3 to "Scroll down").forEach { (delta, label) -> OutlinedButton(enabled = !pending, onClick = { input(JSONObject().put("kind", "scroll").put("deltaY", delta).put("x", 0.5).put("y", 0.5)) }) { Text(label) } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { OutlinedTextField(typed, { typed = it.take(500) }, Modifier.weight(1f), label = { Text("Text for selected PC field") }, maxLines = 2); Button(enabled = typed.isNotBlank() && !pending, onClick = { input(JSONObject().put("kind", "text").put("text", typed)) }) { Text("Type") } }
        }
    }
}
