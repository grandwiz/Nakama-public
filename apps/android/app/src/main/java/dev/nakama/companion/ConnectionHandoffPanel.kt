package dev.nakama.companion

import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.*
import org.json.JSONObject

/** A PC-authorized, one-time credential handoff. Credentials never enter chat, saved state or logs. */
@Composable
fun ConnectionHandoffPanel(deviceId: String?, allowed: Boolean, selectedId: String?, request: suspend (String, String, JSONObject?) -> JSONObject, openBrowser: (String) -> Unit) {
    val activity = LocalActivity.current as? ComponentActivity ?: return
    val scope = rememberCoroutineScope(); val currentAllowed by rememberUpdatedState(allowed)
    var requests by remember { mutableStateOf<List<JSONObject>>(emptyList()) }; var active by remember { mutableStateOf(true) }
    var chosen by remember(selectedId) { mutableStateOf(selectedId.orEmpty()) }; var token by remember { mutableStateOf("") }; var label by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }; var detail by remember { mutableStateOf("") }
    DisposableEffect(activity) {
        val oldFlags = activity.window.attributes.flags; val autofill = activity.window.decorView.importantForAutofill
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE); activity.window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) { active = false; token = "" } else if (event == Lifecycle.Event.ON_RESUME) active = true }
        activity.lifecycle.addObserver(observer)
        onDispose { active = false; token = ""; activity.lifecycle.removeObserver(observer); if (oldFlags and WindowManager.LayoutParams.FLAG_SECURE == 0) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE); activity.window.decorView.importantForAutofill = autofill }
    }
    suspend fun refresh() { val result = request("GET", "/api/connection-handoffs", null); if (currentAllowed && active) requests = result.objects("requests").filter { it.optString("deviceId") == deviceId } }
    LaunchedEffect(allowed, active) {
        if (!allowed || !active) { token = ""; requests = emptyList(); return@LaunchedEffect }
        while (isActive) { try { refresh() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { detail = "Could not refresh account setup. Reconnect to your PC." }; delay(5000) }
    }
    val current = requests.firstOrNull { it.optString("id") == chosen }
    LaunchedEffect(chosen, current?.optString("status")) { token = ""; label = current?.optString("accountLabel").orEmpty() }
    if (!allowed) { Text("Enable Google, project and browser access on your paired PC to use an account handoff."); return }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Account setup", style = MaterialTheme.typography.headlineSmall); Text("Start a targeted account handoff on your PC. Signing into a browser does not connect an API account. Copy the provider token explicitly into this secure field; it is sent only to your paired PC's account vault.", style = MaterialTheme.typography.bodySmall) }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
        if (detail.isNotBlank()) item { Text(detail) }
        if (chosen.isNotBlank()) item { TextButton(onClick = { chosen = ""; token = "" }) { Text("All account handoffs") } }
        if (current == null) {
            items(requests, key = { it.optString("id") }) { entry -> OutlinedButton(onClick = { chosen = entry.optString("id") }) { Text("${entry.optString("provider")} · ${entry.optString("accountLabel")} · ${entry.optString("status")}") } }
            if (requests.isEmpty()) item { Text("No account handoffs for this phone. Create one in Windows Connections.") }
        } else {
            item { Text("${current.optString("provider")} · ${current.optString("accountLabel")}", style = MaterialTheme.typography.titleLarge); MotionStatus(current.optString("status")); Text("Expires: ${current.optString("expiresAt")}", style = MaterialTheme.typography.labelSmall) }
            if (current.optString("status") == "waiting") {
                item { OutlinedButton(enabled = !busy && BrowserInputPolicy.publicUrl(current.optString("loginUrl")), onClick = {
                    busy = true; token = ""
                    scope.launch { try { withContext(NonCancellable) {
                        val result = request("POST", "/api/browser-studio/sessions", JSONObject().put("mode", "private").put("url", current.optString("loginUrl")))
                        val id = result.optJSONObject("session")?.optString("id").orEmpty()
                        if (currentAllowed && active && BrowserInputPolicy.id(id)) openBrowser(id)
                        else if (BrowserInputPolicy.id(id)) runCatching { request("POST", "/api/browser-studio/sessions/$id/release", JSONObject()) }
                    } } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { detail = "The private provider browser could not be opened. Check your PC." } finally { busy = false } }
                }) { Text("Open private provider dashboard") } }
                item { OutlinedTextField(label, { label = it.take(80) }, Modifier.fillMaxWidth(), label = { Text("Account label") }, singleLine = true, enabled = !busy) }
                item { OutlinedTextField(token, { token = it.take(12000) }, Modifier.fillMaxWidth(), label = { Text("Provider API credential") }, singleLine = true, enabled = !busy, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false)) }
                if (current.optString("provider") == "namecheap") item { Text("Namecheap: paste the JSON credential object specified in your PC's connection instructions, including user, key and allowed client IP. Do not put it in Chat.", style = MaterialTheme.typography.bodySmall) }
                item { Button(enabled = !busy && token.isNotBlank() && label.isNotBlank(), onClick = {
                    val credential = token; token = ""; busy = true; detail = ""
                    scope.launch { try {
                        request("POST", "/api/connection-handoffs/${current.optString("id")}/complete", JSONObject().put("token", credential).put("accountLabel", label.trim()))
                        if (currentAllowed && active) { detail = "Account saved on your PC. Verify its connection there before using protected services."; refresh() }
                    } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { if (currentAllowed) detail = "The handoff was not confirmed. Refresh on your PC before trying again; the token field was cleared." } finally { busy = false } }
                }) { Text("Save account on my PC") } }
                item { Text("No voice input or autofill for this credential. Screenshots are blocked here. The field clears when you leave or submit. Provider cookies remain on the PC's isolated browser.", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
