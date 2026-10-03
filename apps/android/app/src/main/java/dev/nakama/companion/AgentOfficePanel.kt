package dev.nakama.companion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import org.json.JSONObject

@Composable
fun AgentOfficePanel(office: JSONObject?, allowed: Boolean, openProject: (String) -> Unit = {}, browserStudio: JSONObject? = null, browserAllowed: Boolean = false, browserRequest: (suspend (String, String, JSONObject?) -> JSONObject)? = null, openBrowser: (String) -> Unit = {}) {
    val motion = LocalNakamaMotion.current
    var selectedId by remember { mutableStateOf<String?>(null) }
    var onlyActive by remember { mutableStateOf(true) }
    if (!allowed) {
        LaunchedEffect(Unit) { selectedId = null }
        Text("Connect your paired PC and enable Google and project access to see the Agent office.")
        return
    }
    val supported = office?.optInt("version") == 1
    val agents = if (supported) office!!.objects("agents") else emptyList()
    val byId = agents.associateBy { it.optString("id") }
    val active = agents.filter { it.optString("status") !in finishedChatWork }
    val visible = if (onlyActive) active else agents
    val sessions = if (browserAllowed) browserStudio?.objects("sessions").orEmpty().filter { it.optString("mode") != "private" && it.optString("status") != "closed" } else emptyList()
    fun browser(agent: JSONObject) = sessions.lastOrNull { item -> item.optString("taskId").isNotBlank() && item.optString("taskId") == agent.optString("taskId") || item.optString("workflowId").isNotBlank() && item.optString("workflowId") == agent.optString("workflowId") }
    val previewAgents = visible.filter { browser(it) != null }.distinctBy { browser(it)?.optString("id") }.take(4).map { it.optString("id") }.toSet()
    LazyVerticalGrid(columns = GridCells.Adaptive(155.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Agent office", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Your team at their desks", style = MaterialTheme.typography.titleMedium)
                Text("Green · GPT   Orange · Claude", style = MaterialTheme.typography.labelMedium)
                Text("Tap an agent to inspect recorded work and its reporting line. Desks show saved host activity, not live thoughts or a promise that a model is running.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = onlyActive, onClick = { onlyActive = true }, label = { Text("Unfinished ${active.size}") })
                    FilterChip(selected = !onlyActive, onClick = { onlyActive = false }, label = { Text("Including history ${agents.size}") })
                }
                if (!supported) Text("This host has not supplied a supported Agent office snapshot yet. Refresh or update Control Center.")
                else if (visible.isEmpty()) Text(if (onlyActive) "No active agents in the latest host snapshot." else "The office is quiet. Real agent desks appear after you request work.")
            }
        }
        items(visible, key = { it.optString("id") }) { agent ->
            val name = agent.optString("name").ifBlank { "Unnamed agent" }
            val provider = agent.optString("providerId")
            val browser = browser(agent)
            val thumbnail = officeBrowserFrame(browser, selectedId == null && agent.optString("id") in previewAgents, browserRequest)
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = tween(MotionPolicy.duration(motion, 220))).fillMaxWidth().clickable { selectedId = agent.optString("id") }.semantics { contentDescription = "Open agent $name" }) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    AgentDesk(provider, Modifier.fillMaxWidth().height(115.dp), thumbnail)
                    Text(name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text(providerLabel(provider) + " · " + agent.optString("role").replace('_', ' '), style = MaterialTheme.typography.labelSmall)
                    Text(recordKind(agent), style = MaterialTheme.typography.labelSmall)
                    Text(agent.optString("title"), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    MotionStatus(agent.optString("status"))
                    if (browser != null) Text("Browser · ${browser.optString("status").replace('_', ' ')}", style = MaterialTheme.typography.labelSmall)
                    val parent = byId[agent.optString("parentId")]
                    if (parent != null) Text("Reports to ${parent.optString("name")}", maxLines = 2, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
    val selected = agents.firstOrNull { it.optString("id") == selectedId }
    selected?.let { agent ->
        val parent = byId[agent.optString("parentId")]
        val children = agents.filter { it.optString("parentId") == agent.optString("id") }
        AlertDialog(onDismissRequest = { selectedId = null }, title = { Text(agent.optString("name").ifBlank { "Agent" }) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(providerLabel(agent.optString("providerId")) + " · " + agent.optString("role").replace('_', ' '), fontWeight = FontWeight.Bold)
                Text(recordKind(agent), style = MaterialTheme.typography.labelMedium)
                Text(agent.optString("title"))
                Text("Status: ${agent.optString("status").replace('_', ' ')}\nPhase: ${agent.optString("phase").ifBlank { "Not recorded" }}")
                browser(agent)?.let { session ->
                    val thumbnail = officeBrowserFrame(session, browserAllowed, browserRequest)
                    thumbnail?.let { Image(it.asImageBitmap(), "Live agent browser preview", modifier = Modifier.fillMaxWidth().height(160.dp)) }
                    Text("Browser: ${session.optString("status").replace('_', ' ')}\n${session.optString("attentionReason")}", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { selectedId = null; openBrowser(session.optString("id")) }) { Text("Open agent browser") }
                }
                parent?.let { TextButton(onClick = { selectedId = it.optString("id") }) { Text("Reports to ${it.optString("name")}") } }
                if (parent == null && agent.optString("parentId").isNotBlank()) Text("Parent record is outside this snapshot.")
                if (children.isNotEmpty()) { Text("Delegated work", fontWeight = FontWeight.Bold); children.forEach { child -> TextButton(onClick = { selectedId = child.optString("id") }) { Text("${child.optString("name")} · ${child.optString("status").replace('_', ' ')}") } } }
                if (agent.optString("model").isNotBlank()) Text("Model: ${agent.optString("model")}")
                Text("Requested effort: ${agent.optString("requestedEffort").ifBlank { "Not recorded" }}\nEffective effort: ${agent.optString("effectiveEffort").ifBlank { "Not recorded" }}", style = MaterialTheme.typography.bodySmall)
                Text("Created: ${agent.optString("createdAt")}\nUpdated: ${agent.optString("updatedAt").ifBlank { "Not recorded" }}", style = MaterialTheme.typography.bodySmall)
                if (agent.optString("error").isNotBlank()) { Text("Recorded error", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold); SelectionContainer { Text(agent.optString("error")) } }
                if (agent.optString("summary").isNotBlank()) { Text("Recorded summary", fontWeight = FontWeight.Bold); SelectionContainer { Text(agent.optString("summary")) } }
                Text("Recorded output", fontWeight = FontWeight.Bold)
                SelectionContainer { Text(agent.optString("output").ifBlank { "No output has been recorded for this agent." }) }
                if (agent.optBoolean("outputTruncated")) Text("The host supplied an excerpt. Open the full task on your PC for the remaining output.", style = MaterialTheme.typography.bodySmall)
                if (agent.optString("projectId").isNotBlank() && agent.optString("projectId") != "null") TextButton(onClick = { selectedId = null; openProject(agent.optString("projectId")) }) { Text("Open project conversation") }
            }
        }, confirmButton = { TextButton(onClick = { selectedId = null }) { Text("Close agent") } })
    }
}

private fun providerLabel(value: String) = when (value) { "codex", "openai" -> "GPT"; "claude" -> "Claude"; else -> value.ifBlank { "Provider not recorded" } }
private fun recordKind(agent: JSONObject) = when {
    agent.optString("sourceKind") == "workflow" || agent.optString("receiptKind") == "workflow_orchestration" -> "Workflow coordinator · saved stage"
    agent.optString("receiptKind") == "tool_task" || agent.optString("providerId") == "terminal" -> "Tool task · recorded execution"
    else -> "Model task · recorded activity"
}

/** Original Mote-shaped team illustration; visual decoration never implies model activity. */
@Composable private fun AgentDesk(provider: String, modifier: Modifier, browser: android.graphics.Bitmap? = null) {
    val fur = when (provider) { "codex", "openai" -> Color(0xFF4EB98A); "claude" -> Color(0xFFEAA064); else -> Color(0xFF9CAEC4) }
    Canvas(modifier) {
        scale(size.width / 180f, size.height / 115f, Offset.Zero) {
            drawOval(Color(0x15202D44), Offset(9f, 103f), Size(166f, 10f))
            drawRoundRect(Color(0xFF567081), Offset(69f, 51f), Size(59f, 53f), CornerRadius(12f))
            val ears = Path().apply { moveTo(54f, 31f); quadraticBezierTo(41f, 2f, 58f, 10f); lineTo(71f, 20f); quadraticBezierTo(85f, 15f, 101f, 21f); quadraticBezierTo(124f, 0f, 123f, 18f); lineTo(118f, 35f); cubicTo(137f, 79f, 53f, 85f, 54f, 31f); close() }
            drawPath(ears, fur)
            drawOval(Color.White.copy(alpha = .23f), Offset(68f, 24f), Size(27f, 7f))
            drawOval(Color(0xFF18303C), Offset(69f, 39f), Size(7f, 10f)); drawOval(Color(0xFF18303C), Offset(103f, 39f), Size(7f, 10f))
            drawCircle(Color.White, 1.5f, Offset(72f, 42f)); drawCircle(Color.White, 1.5f, Offset(106f, 42f))
            drawPath(Path().apply { moveTo(84f, 53f); quadraticBezierTo(90f, 59f, 96f, 53f) }, Color(0xFF18303C), style = Stroke(2f))
            drawRoundRect(Color(0xFFBD8E65), Offset(16f, 83f), Size(148f, 8f), CornerRadius(3f))
            drawRoundRect(Color(0xFF886749), Offset(24f, 89f), Size(7f, 22f), CornerRadius(2f)); drawRoundRect(Color(0xFF886749), Offset(147f, 89f), Size(7f, 22f), CornerRadius(2f))
            drawRoundRect(Color(0xFF263F52), Offset(36f, 52f), Size(72f, 35f), CornerRadius(4f))
            drawRoundRect(Color(0xFFDAEAF0), Offset(40f, 56f), Size(64f, 26f), CornerRadius(2f))
            drawLine(fur, Offset(45f, 64f), Offset(72f, 64f), 3f); drawLine(Color(0xFF718E9E), Offset(45f, 71f), Offset(91f, 71f), 2f)
            browser?.let { drawImage(it.asImageBitmap(), dstOffset = IntOffset(40, 56), dstSize = IntSize(64, 26)) }
            drawRoundRect(Color(0xFFFCF3DC), Offset(127f, 69f), Size(15f, 15f), CornerRadius(3f))
            drawCircle(Color(0xFFFCF3DC), 4f, Offset(143f, 75f), style = Stroke(3f))
        }
    }
}
