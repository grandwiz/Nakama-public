package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToInt

data class UsageWindow(val label: String, val usedPercent: Double, val remainingPercent: Double, val resetsAt: Instant?)
data class ProviderUsage(val id: String, val name: String, val status: String, val windows: List<UsageWindow>, val checkedAt: Instant?, val detail: String, val source: String)
object ProviderUsageModels {
    private val known = linkedMapOf("codex" to "ChatGPT", "claude" to "Claude")
    private fun text(json: JSONObject, key: String, max: Int = 700) = (json.opt(key) as? String).orEmpty().replace(Regex("[\\u0000-\\u001F\\u007F]"), " ").take(max)
    private fun instant(json: JSONObject, key: String) = runCatching { Instant.parse(json.opt(key) as? String) }.getOrNull()
    fun parse(json: JSONObject): List<ProviderUsage> = known.map { (id, name) ->
        val item = json.objects("providers").firstOrNull { it.optString("id") == id } ?: JSONObject()
        val status = item.optString("status").takeIf { it in setOf("available", "unavailable", "error") } ?: "unavailable"
        val windows = if (status == "available") item.objects("windows").take(8).mapNotNull { window ->
            val used = (window.opt("usedPercent") as? Number)?.toDouble() ?: return@mapNotNull null
            val remaining = (window.opt("remainingPercent") as? Number)?.toDouble() ?: return@mapNotNull null
            if (!used.isFinite() || !remaining.isFinite() || used !in 0.0..100.0 || remaining !in 0.0..100.0 || abs(used + remaining - 100) > 1) return@mapNotNull null
            UsageWindow(text(window, "label", 100).ifBlank { "Account limit" }, used, remaining, instant(window, "resetsAt"))
        } else emptyList()
        ProviderUsage(id, name, if (status == "available" && windows.isEmpty()) "unavailable" else status, windows,
            instant(item, "checkedAt"), text(item, "detail").ifBlank { "This provider has not supplied a supported usage reading. Remaining usage is unknown." }, text(item, "source", 200))
    }
}

@Composable
fun ProviderUsagePanel(identity: HostIdentity?, connected: Boolean, allowed: Boolean,
                       request: suspend (HostIdentity, String, String, JSONObject?) -> JSONObject,
                       back: () -> Unit) {
    val access = UsageScope(identity, connected, allowed)
    val gate = remember { UsageRequestGate() }
    gate.update(access)
    val coroutineScope = rememberCoroutineScope()
    var providers by remember(access) { mutableStateOf<List<ProviderUsage>>(emptyList()) }
    var busy by remember(access) { mutableStateOf(false) }
    var detail by remember(access) { mutableStateOf("") }
    fun refresh() {
        val ticket = gate.begin() ?: return
        busy = true; providers = emptyList(); detail = ""
        coroutineScope.launch {
            try {
                val result = request(requireNotNull(ticket.scope.identity), "GET", "/api/providers/usage", null)
                if (gate.accepts(ticket)) providers = ProviderUsageModels.parse(result)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (gate.accepts(ticket)) detail = when {
                error is HostException && error.status in listOf(401, 403) -> "Usage access is unavailable. Check this device's connection and Google access permission in Control Center."
                error is HostException && error.status == 404 -> "Update Windows Control Center to see account usage here."
                else -> "Could not refresh usage. Check your PC and private connection, then try again."
            } } finally { if (gate.finish(ticket)) busy = false }
        }
    }
    // No polling: one read when this screen acquires access, then explicit refreshes only.
    LaunchedEffect(access) { refresh() }
    DisposableEffect(Unit) { onDispose { gate.invalidate() } }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { TextButton(onClick = back) { Text("‹ Back") }; Text("Your AI usage", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Account limits include usage outside Nakama when the provider reports it. Unknown limits stay unknown.", style = MaterialTheme.typography.bodyMedium) }
        item { OutlinedButton(onClick = ::refresh, enabled = identity != null && connected && allowed && !busy) { Text("Refresh usage") } }
        if (busy) item { NakamaBusy(Modifier.fillMaxWidth()); Text("Checking your connected accounts…") }
        if (identity == null) item { Text("Pair your PC from the Device tab first.") }
        else if (!connected) item { Text("Reconnect to your PC to view usage. Previous readings are hidden while disconnected.") }
        else if (!allowed) item { Text("Usage is unavailable while Google access is disabled for this device. Review its permissions in Control Center.") }
        if (detail.isNotBlank()) item { Text(detail, color = MaterialTheme.colorScheme.error) }
        items(providers) { provider ->
            Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(provider.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    if (provider.windows.isEmpty()) Text("Remaining usage unavailable", style = MaterialTheme.typography.titleMedium)
                    provider.windows.forEach { window ->
                        Text(window.label, fontWeight = FontWeight.Medium)
                        Text("${window.remainingPercent.roundToInt()}% remaining", style = MaterialTheme.typography.headlineSmall)
                        LinearProgressIndicator(progress = { (window.remainingPercent / 100).toFloat() }, modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.secondary)
                        Text("${window.usedPercent.roundToInt()}% used · " + (window.resetsAt?.let { "Resets ${usageDate(it)}" } ?: "Reset time unavailable"), style = MaterialTheme.typography.bodySmall)
                    }
                    Text(provider.detail, style = MaterialTheme.typography.bodySmall)
                    if (provider.source.isNotBlank()) Text(provider.source, style = MaterialTheme.typography.labelSmall)
                    Text(provider.checkedAt?.let { "Checked ${usageDate(it)} · refresh for a new reading" } ?: "No verified reading", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        item { Text("No paid API fallback or automatic credit purchase. Limits belong to each provider and may change before your next request.", style = MaterialTheme.typography.bodySmall) }
    }
}
private fun usageDate(value: Instant) = DateTimeFormatter.ofPattern("d MMM, HH:mm").withZone(ZoneId.systemDefault()).format(value)
