package dev.nakama.companion

import android.graphics.Bitmap
import android.util.Base64
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URI

object BrowserInputPolicy {
    fun id(value: String) = value.matches(Regex("[A-Za-z0-9_-]{1,100}"))
    fun publicUrl(value: String): Boolean = runCatching { val uri = URI(value); uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && value.length <= 2000 }.getOrDefault(false)
    fun ownControl(session: JSONObject?, deviceId: String?) = deviceId != null && session?.optJSONObject("controller")?.let { it.optString("kind") == "device" && it.optString("id") == deviceId } == true
    fun mayView(session: JSONObject?, deviceId: String?): Boolean = session != null && session.optString("status") !in listOf("closed", "error") && (ownControl(session, deviceId) || session.optString("mode") != "private" && !session.optBoolean("tainted") && session.optJSONObject("controller") == null)
    fun fresh(frame: JSONObject?) = frame != null && runCatching { java.time.Instant.parse(frame.optString("expiresAt")).isAfter(java.time.Instant.now()) }.getOrDefault(false)
    fun image(frame: JSONObject): Bitmap {
        val data = frame.getString("image"); require(data.startsWith("data:image/jpeg;base64,") || data.startsWith("data:image/png;base64,")); require(data.length <= 1_900_000)
        return ProjectFilePolicy.decodeImage(Base64.decode(data.substringAfter(','), Base64.NO_WRAP))
    }
}

@Composable
fun BrowserStudioPanel(deviceId: String?, allowed: Boolean, projects: List<JSONObject>, initialSessionId: String?, request: suspend (String, String, JSONObject?) -> JSONObject) {
    val activity = LocalActivity.current as? ComponentActivity ?: return
    val scope = rememberCoroutineScope(); val mutex = remember { Mutex() }
    val currentAllowed by rememberUpdatedState(allowed); val latestRequest by rememberUpdatedState(request)
    var active by remember { mutableStateOf(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    var mounted by remember { mutableStateOf(true) }; var studio by remember { mutableStateOf(JSONObject()) }
    var selected by remember { mutableStateOf(initialSessionId.orEmpty()) }; var tab by remember { mutableStateOf("") }
    var frame by remember { mutableStateOf<JSONObject?>(null) }; var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var error by remember { mutableStateOf("") }; var pending by remember { mutableStateOf(false) }; var dragging by remember { mutableStateOf(false) }
    var address by remember { mutableStateOf("") }; var typed by remember { mutableStateOf("") }; var conceal by remember { mutableStateOf(true) }
    var keyboard by remember { mutableStateOf(false) }; var showAddress by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }; var mode by remember { mutableStateOf("research") }; var newProject by remember { mutableStateOf("") }; var newAddress by remember { mutableStateOf("") }
    var session by remember { mutableStateOf<JSONObject?>(null) }
    var viewGeneration by remember { mutableLongStateOf(0L) }
    val latestSession by rememberUpdatedState(session)
    val own = BrowserInputPolicy.ownControl(session, deviceId)
    fun clearPixels() { frame = null; bitmap = null; typed = "" }
    fun choose(id: String) {
        val previous = session
        if (previous?.optString("id") != id && BrowserInputPolicy.ownControl(previous, deviceId)) scope.launch { runCatching { request("POST", "/api/browser-studio/sessions/${previous?.optString("id")}/release", JSONObject()) } }
        viewGeneration++; selected = id; tab = ""; address = ""; keyboard = false; showAddress = false; clearPixels()
    }
    suspend fun refresh() {
        val result = request("GET", "/api/browser-studio", null)
        if (active && mounted && currentAllowed) {
            studio = result; val next = result.objects("sessions").firstOrNull { it.optString("id") == selected }
            session = next
            if (next == null) clearPixels()
            else if (next.objects("tabs").none { it.optString("id") == tab }) { tab = next.optString("activeTabId"); clearPixels() }
        }
    }
    fun release() {
        val id = selected; val wasOwn = BrowserInputPolicy.ownControl(session, deviceId); clearPixels()
        if (wasOwn && BrowserInputPolicy.id(id)) scope.launch { runCatching { request("POST", "/api/browser-studio/sessions/$id/release", JSONObject()) }.onFailure { error = "Browser input stopped locally. Reconnect to confirm release on your PC." } }
    }
    fun operation(method: String, path: String, body: JSONObject? = JSONObject()) {
        if (!allowed || !active || pending) return
        val ticket = viewGeneration
        pending = true; error = ""
        scope.launch {
            try {
                withContext(NonCancellable) {
                    val result = request(method, path, body)
                    if (mounted && active && currentAllowed && ticket == viewGeneration) {
                        if (path == "/api/browser-studio/sessions") { val created = result.optJSONObject("session") ?: result; created.optString("id").takeIf(BrowserInputPolicy::id)?.let(::choose); creating = false }
                        clearPixels(); refresh()
                    } else {
                        val id = result.optJSONObject("session")?.optString("id").orEmpty()
                        if ((path.endsWith("/takeover") || path == "/api/browser-studio/sessions") && BrowserInputPolicy.ownControl(result.optJSONObject("session"), deviceId) && BrowserInputPolicy.id(id)) runCatching { request("POST", "/api/browser-studio/sessions/$id/release", JSONObject()) }
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { if (mounted && currentAllowed) error = failure.message.orEmpty() }
            finally { pending = false }
        }
    }
    fun input(body: JSONObject) {
        val snapshot = frame ?: return; val sessionId = selected; val tabId = tab
        if (!own || !allowed || !active || pending) return
        if (!BrowserInputPolicy.fresh(snapshot)) { clearPixels(); error = "This image expired. Wait for a fresh frame."; return }
        pending = true; error = ""
        scope.launch { try { mutex.withLock {
            check(currentAllowed && active && BrowserInputPolicy.ownControl(latestSession, deviceId) && selected == sessionId && tab == tabId && frame?.optString("frameId") == snapshot.optString("frameId") && BrowserInputPolicy.fresh(snapshot)) { "The browser image changed. Use the current image again." }
            request("POST", "/api/browser-studio/sessions/$sessionId/control", body.put("tabId", tabId).put("frameId", snapshot.optString("frameId")))
            frame = null; typed = ""
        } } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { frame = null; typed = ""; if (currentAllowed) error = failure.message.orEmpty() } finally { pending = false } }
    }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) { active = false; release() } else if (event == Lifecycle.Event.ON_RESUME) active = true }
        activity.lifecycle.addObserver(observer)
        onDispose {
            mounted = false; activity.lifecycle.removeObserver(observer)
            val previous = latestSession
            if (BrowserInputPolicy.ownControl(previous, deviceId)) CoroutineScope(Dispatchers.Main).launch { runCatching { latestRequest("POST", "/api/browser-studio/sessions/${previous?.optString("id")}/release", JSONObject()) } }
        }
    }
    val protectScreen = session?.optString("mode") == "private" || own
    LaunchedEffect(initialSessionId) { if (initialSessionId.orEmpty() != selected) { choose(initialSessionId.orEmpty()); session = null } }
    DisposableEffect(protectScreen) {
        val previous = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        if (protectScreen) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (protectScreen && !previous) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    LaunchedEffect(allowed, active, selected) {
        if (!allowed || !active) { clearPixels(); if (!allowed) { studio = JSONObject(); session = null; address = ""; newAddress = ""; creating = false }; return@LaunchedEffect }
        while (isActive) { try { refresh() } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { clearPixels(); error = failure.message.orEmpty() }; delay(1800) }
    }
    LaunchedEffect(allowed, active, selected, tab, session?.optString("status"), own) {
        clearPixels()
        if (!allowed || !active || !BrowserInputPolicy.id(selected) || !BrowserInputPolicy.id(tab) || session == null || session?.optString("status") in listOf("closed", "error")) return@LaunchedEffect
        if ((session?.optString("mode") == "private" || session?.optBoolean("tainted") == true) && !own || session?.optJSONObject("controller") != null && !own) return@LaunchedEffect
        val expected = selected; val expectedTab = tab; val controller = session?.optJSONObject("controller")?.toString(); val wasTainted = session?.optBoolean("tainted")
        while (isActive) {
            if (pending || dragging) { delay(250); continue }
            try { mutex.withLock {
                val result = request("POST", "/api/browser-studio/sessions/$expected/frame", JSONObject().put("tabId", expectedTab))
                val picture = withContext(Dispatchers.Default) { BrowserInputPolicy.image(result) }
                if (currentAllowed && active && selected == expected && tab == expectedTab && !dragging && BrowserInputPolicy.mayView(latestSession, deviceId) && latestSession?.optJSONObject("controller")?.toString() == controller && latestSession?.optBoolean("tainted") == wasTainted) { frame = result; bitmap = picture }
            } } catch (cancelled: CancellationException) { throw cancelled } catch (failure: Exception) { clearPixels(); if (currentAllowed) error = failure.message.orEmpty() }
            delay(750)
        }
    }
    if (!allowed) { Text("Connect your paired PC and enable Google, project and browser control access to view browser sessions."); return }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Browser studio", style = MaterialTheme.typography.headlineSmall)
        Text(if (session == null) "Chromium runs on your PC. Taking control pauses agent interaction. Private login stays human-only; credentials never become chat or model instructions." else "PC browser · human control pauses agents · private input stays out of chat", style = MaterialTheme.typography.bodySmall)
        if (pending) NakamaBusy(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(enabled = studio.optBoolean("available") && studio.optBoolean("permitted") && !pending, onClick = { creating = true }) { Text("New browser") }
            if (selected.isNotBlank()) TextButton(onClick = { choose(""); session = null }) { Text("All sessions") }
        }
        if (session == null) {
            if (!studio.optBoolean("available")) Text(studio.optString("detail").ifBlank { "Checking browser availability…" })
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(studio.objects("sessions").filter { it.optString("status") != "closed" }, key = { it.optString("id") }) { item ->
                    OutlinedButton(onClick = { choose(item.optString("id")); session = item }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) { Text("${item.optString("mode")} browser"); Text(item.optString("status").replace('_', ' '), style = MaterialTheme.typography.labelMedium); if (item.optString("attentionReason").isNotBlank()) Text(item.optString("attentionReason"), style = MaterialTheme.typography.bodySmall) }
                    }
                }
                if (studio.objects("sessions").isEmpty()) item { Text("No browser sessions. Create one or open an agent's browser from Agent office.") }
            }
        } else {
            val current = session!!
            MotionStatus(current.optString("status"))
            if (current.optString("attentionReason").isNotBlank()) Text(current.optString("attentionReason"), style = MaterialTheme.typography.bodySmall)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                current.objects("tabs").forEachIndexed { index, item -> FilterChip(selected = tab == item.optString("id"), onClick = { viewGeneration++; tab = item.optString("id"); address = ""; clearPixels() }, label = { Text(item.optString("title").ifBlank { "Tab ${index + 1}" }.take(50)) }) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!own && current.optString("mode") != "research") Button(enabled = !pending, onClick = { operation("POST", "/api/browser-studio/sessions/$selected/takeover") }) { Text("Take human control") }
                if (own) OutlinedButton(enabled = !pending, onClick = { operation("POST", "/api/browser-studio/sessions/$selected/release") }) { Text("Release control") }
                if (own || current.optString("mode") == "research") TextButton(onClick = { showAddress = !showAddress }) { Text("Address / tabs") }
                TextButton(enabled = !pending, onClick = { operation("DELETE", "/api/browser-studio/sessions/$selected", null) }) { Text("Close browser") }
            }
            if (showAddress && (own || current.optString("mode") == "research")) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(address, { address = it.take(2000) }, Modifier.weight(1f), label = { Text(if (current.optString("mode") == "project") "Registered project URL" else "HTTPS address") }, singleLine = true, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
                    TextButton(enabled = !pending && address.isNotBlank(), onClick = { operation("POST", "/api/browser-studio/sessions/$selected/navigate", JSONObject().put("tabId", tab).put("url", address)) }) { Text("Go") }
                    TextButton(enabled = !pending, onClick = { operation("POST", "/api/browser-studio/sessions/$selected/tabs", JSONObject().apply { if (address.isNotBlank()) put("url", address) }) }) { Text("New tab") }
                }
            }
            val picture = bitmap.takeIf { BrowserInputPolicy.mayView(current, deviceId) }
            if (picture == null) Box(Modifier.weight(1f).fillMaxWidth()) { Text(if (current.optString("mode") == "private" && !own) "Take human control to see this private browser." else "Waiting for a permitted browser frame…") }
            else Image(picture.asImageBitmap(), "Current host browser frame", contentScale = ContentScale.Fit, modifier = Modifier.weight(1f).fillMaxWidth()
                .pointerInput(frame?.optString("frameId"), own) { detectTapGestures(onTap = { position -> if (own) RemotePointer.point(position.x, position.y, size.width, size.height, picture.width, picture.height)?.let { input(JSONObject().put("kind", "tap").put("x", it.x).put("y", it.y)) } }) }
                .pointerInput(selected, tab, own) {
                    var start: Offset? = null; var changeY = 0f; var receipt: String? = null
                    detectDragGestures(onDragStart = { if (own) { dragging = true; start = it; receipt = frame?.optString("frameId"); changeY = 0f } }, onDragCancel = { dragging = false }, onDragEnd = {
                        if (own && receipt == frame?.optString("frameId") && kotlin.math.abs(changeY) > 12) start?.let { position -> RemotePointer.point(position.x, position.y, size.width, size.height, picture.width, picture.height)?.let { point -> input(JSONObject().put("kind", "scroll").put("x", point.x).put("y", point.y).put("deltaY", if (changeY < 0) 3 else -3)) } }
                        dragging = false
                    }, onDrag = { change, amount -> if (own) { changeY += amount.y; change.consume() } })
                })
            frame?.let { Text("Captured ${it.optString("capturedAt")}", style = MaterialTheme.typography.labelSmall) }
            if (own) OutlinedButton(onClick = { keyboard = true }) { Text("Keyboard") }
        }
    }
    if (keyboard && own && active && allowed) AlertDialog(onDismissRequest = { keyboard = false; typed = "" }, title = { Text("Browser keyboard") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("Tab", "Enter", "Backspace", "Escape").forEach { key -> OutlinedButton(enabled = !pending && frame != null, onClick = { input(JSONObject().put("kind", "key").put("key", key)) }) { Text(key) } } }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(typed, { typed = it.take(500) }, Modifier.weight(1f), label = { Text("Text for focused browser field") }, singleLine = true, visualTransformation = if (conceal) PasswordVisualTransformation() else VisualTransformation.None, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false))
                    TextButton(enabled = typed.isNotBlank() && !pending && frame != null, onClick = { input(JSONObject().put("kind", "text").put("text", typed)) }) { Text("Type") }
                }
                Row { Checkbox(!conceal, { conceal = !it }); Text("Show typed text", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelSmall) }
                Text("Text clears after input or leaving this view. Human-controlled pages do not feed agents or reports.", style = MaterialTheme.typography.bodySmall)
            }
    }, confirmButton = { TextButton(onClick = { keyboard = false; typed = "" }) { Text("Close keyboard") } })
    if (creating) AlertDialog(onDismissRequest = { if (!pending) creating = false }, title = { Text("New browser session") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.horizontalScroll(rememberScrollState())) { listOf("research", "project", "private").forEach { item -> FilterChip(mode == item, onClick = { mode = item }, label = { Text(item) }) } }
            Text(when (mode) { "private" -> "Human-only HTTPS login in an isolated browser. Take control before viewing."; "project" -> "Uses the project's registered local preview origin. Your PC must launch/register it first."; else -> "Anonymous public research only. Forms, login and text input are unavailable." }, style = MaterialTheme.typography.bodySmall)
            if (mode == "project") Column(Modifier.heightIn(max = 180.dp)) { LazyColumn { items(projects, key = { it.optString("id") }) { project -> FilterChip(newProject == project.optString("id"), onClick = { newProject = project.optString("id") }, label = { Text(project.optString("name")) }) } } }
            else OutlinedTextField(newAddress, { newAddress = it.take(2000) }, label = { Text("HTTPS address · optional") }, singleLine = true)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = { TextButton(enabled = !pending && (if (mode == "project") newProject.isNotBlank() else newAddress.isBlank() || BrowserInputPolicy.publicUrl(newAddress)), onClick = { operation("POST", "/api/browser-studio/sessions", JSONObject().put("mode", mode).apply { if (mode == "project") put("projectId", newProject) else if (newAddress.isNotBlank()) put("url", newAddress) }) }) { Text("Create browser") } }, dismissButton = { TextButton(enabled = !pending, onClick = { creating = false }) { Text("Cancel") } })
}
