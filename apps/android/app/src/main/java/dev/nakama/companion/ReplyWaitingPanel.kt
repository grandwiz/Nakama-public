package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ReplyWaitingPanel(provider: String, effort: String, elapsedMs: Long, phase: String = "") {
    val seconds = (elapsedMs / 1_000).coerceAtLeast(0)
    val elapsed = if (seconds < 60) "${seconds}s" else "${seconds / 60}m ${seconds % 60}s"
    val label = when (phase) {
        "checking_account" -> "Checking your AI account"
        "starting_model" -> "Waiting for ${provider.ifBlank { "your AI" }}"
        "answering" -> "Finishing your reply"
        else -> "${provider.ifBlank { "Your AI" }} is preparing a reply"
    }
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (LocalNakamaMotion.current) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp)
                else Text("◌")
                Text("$label · $elapsed", style = MaterialTheme.typography.labelLarge)
            }
            if (seconds >= 20) Text(
                if (effort in listOf("ultra", "max", "xhigh")) "Higher thinking effort can take longer. Change everyday chat in Control Center → Settings → AI roles."
                else "Your PC is still waiting for the AI. You can stop the task in the conversation.",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}
