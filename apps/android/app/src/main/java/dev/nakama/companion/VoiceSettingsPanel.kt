package dev.nakama.companion

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun VoiceSettingsPanel(voice: VoiceController, openSpeechSettings: () -> Unit, openInputSettings: () -> Unit) {
    var choosing by remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Your British English voice", style = MaterialTheme.typography.titleMedium)
            Text(voice.engineStatus, style = MaterialTheme.typography.bodyMedium)
            if (voice.engine.isNotBlank()) Text("Android engine: ${voice.engine}", style = MaterialTheme.typography.labelSmall)
            Box {
                OutlinedButton(onClick = { choosing = true }, enabled = voice.voices.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                    Text(voice.selectedVoice.ifBlank { "Choose an installed voice" })
                }
                DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }) {
                    voice.voices.forEach { item ->
                        DropdownMenuItem(enabled = item.usableOffline, text = {
                            Column { Text(item.name); Text(item.detail, style = MaterialTheme.typography.labelSmall) }
                        }, onClick = { choosing = false; voice.selectVoice(item.name) })
                    }
                }
            }
            Text("Only installed offline voices are used. Android does not reliably label gender: preview voices to find the sound you prefer. Changing a choice does not play audio.", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                VoicePolicy.rates.forEach { (label, speed) -> FilterChip(selected = voice.rate == speed, onClick = { voice.changeRate(speed) }, label = { Text(label) }) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = voice::preview, enabled = voice.ready) { Text("Preview voice") }
                OutlinedButton(onClick = voice::stop) { Text("Stop voice") }
            }
            Text(voice.activityStatus, style = MaterialTheme.typography.labelSmall)
            OutlinedButton(onClick = openSpeechSettings, modifier = Modifier.fillMaxWidth()) { Text("Android speech settings") }
            OutlinedButton(onClick = voice::refresh, modifier = Modifier.fillMaxWidth()) { Text("Refresh voices") }
            HorizontalDivider()
            Text("Microphone recognition", style = MaterialTheme.typography.titleSmall)
            Text(voice.recognitionMode.explanation, style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Allow Android recognition service", style = MaterialTheme.typography.bodyMedium)
                    Text("Used only when on-device recognition is unavailable. Its provider may receive audio and use your data connection. No paid Nakama voice API is configured.", style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = voice.allowSystemRecognition, onCheckedChange = voice::allowServiceRecognition,
                    modifier = Modifier.semantics { contentDescription = "Allow Android recognition service" })
            }
            TextButton(onClick = openInputSettings) { Text("Android voice input settings") }
        }
    }
}
