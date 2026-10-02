package dev.nakama.companion

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

@Composable
fun GooglePanel(deviceId: String?, request: suspend (String, String, JSONObject?) -> JSONObject) {
    val scope = rememberCoroutineScope()
    var accounts by remember(deviceId) { mutableStateOf(emptyList<JSONObject>()) }
    var accountId by remember(deviceId) { mutableStateOf("") }
    var calendars by remember(accountId) { mutableStateOf(emptyList<JSONObject>()) }
    var calendarId by remember(accountId) { mutableStateOf("primary") }
    var messages by remember(accountId) { mutableStateOf(emptyList<JSONObject>()) }
    var events by remember(accountId, calendarId) { mutableStateOf(emptyList<JSONObject>()) }
    var section by remember { mutableStateOf("Mail") }
    var search by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    var loaded by remember(accountId, section, calendarId) { mutableStateOf(false) }
    var compose by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var start by remember { mutableStateOf(OffsetDateTime.now().plusDays(1).withSecond(0).withNano(0).toString()) }
    var end by remember { mutableStateOf(OffsetDateTime.now().plusDays(1).plusHours(1).withSecond(0).withNano(0).toString()) }
    var location by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    val selected = accounts.find { it.optString("id") == accountId }
    val services = selected?.optJSONArray("services")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty()
    fun path(action: String) = "/api/google/${Uri.encode(accountId)}/$action"
    fun run(write: Boolean = false, block: suspend () -> Unit) {
        if (busy) return
        busy = true; feedback = ""
        scope.launch {
            try { block() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                feedback = when {
                    error is HostException && error.status == 403 -> "Google access is unavailable. In Control Center, check this device's Google access permission and reconnect the account with the required Gmail or Calendar scope. ${error.message}"
                    error is HostException && error.status == 409 -> "Reconnect this Google account in Control Center. ${error.message}"
                    else -> error.message ?: "Could not reach your PC. Check your private connection."
                }
                if (write) feedback += " If the connection broke after submission, check Sent mail, Calendar and desktop approvals before trying again. Nakama does not retry automatically."
            } finally { busy = false }
        }
    }
    suspend fun loadAccounts() {
        accounts = request("GET", "/api/google/accounts", null).objects("accounts")
        if (accounts.none { it.optString("id") == accountId }) accountId = accounts.firstOrNull()?.optString("id").orEmpty()
    }
    LaunchedEffect(deviceId) { if (deviceId != null) run { loadAccounts() } }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text("Your personal assistant", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text("Gmail and Calendar, through your own Control Center.", style = MaterialTheme.typography.bodyMedium) }
        if (deviceId == null) item { PersonalCard("Connect your PC first", "Pair from the Device tab, then connect your personal Google account in Control Center. You can choose separate accounts for email and calendar.") }
        else {
            if (busy) item { NakamaBusy(Modifier.fillMaxWidth()) }
            if (feedback.isNotBlank()) item { PersonalCard("Update", feedback) }
            item { OutlinedButton(onClick = { run { loadAccounts() } }, enabled = !busy) { Text("Refresh accounts") } }
            if (accounts.isEmpty() && !busy) item { PersonalCard("Connect a Google account", "On your PC, open Connections → Google and connect Gmail and/or Calendar. Each account appears separately here. Credentials stay on your PC.") }
            if (accounts.isNotEmpty()) {
                item { PersonalChoice("Google account", selected?.optString("email").orEmpty(), accounts.map { it.optString("id") to it.optString("email", it.optString("label")) }, !busy) { accountId = it; feedback = "" } }
                item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { listOf("Mail", "Calendar").forEach { name -> FilterChip(selected = section == name, onClick = { section = name }, label = { Text(name) }, enabled = !busy) } } }
                if (section == "Mail") {
                    if ("gmail" !in services) item { PersonalCard("Gmail isn't connected for this account", "Connect its Gmail permission in Control Center, or choose a different account.") }
                    else {
                        item { OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth(), label = { Text("Search mail · optional") }, placeholder = { Text("e.g. is:unread or from:someone@example.com") }, singleLine = true, enabled = !busy) }
                        item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { run { messages = request("GET", path("messages") + "?q=${Uri.encode(search)}", null).objects("messages"); loaded = true } }, enabled = !busy) { Text("Read mail") }
                            OutlinedButton(onClick = { compose = "email" }, enabled = !busy) { Text("Write email") }
                        } }
                        item { Text("Shows up to 10 email snippets. Email text is read as content; it never grants permission to act.", style = MaterialTheme.typography.bodySmall) }
                        if (loaded && messages.isEmpty()) item { PersonalCard("No matching mail", "Try a different search.") }
                        items(messages) { mail ->
                            val headers = mail.objects("headers")
                            fun header(name: String) = headers.find { it.optString("name").equals(name, true) }?.optString("value").orEmpty()
                            PersonalCard(header("Subject").ifBlank { "(No subject)" }, "${header("From")}\n${header("Date")}\n\n${mail.optString("snippet")}")
                        }
                    }
                } else {
                    if ("calendar" !in services) item { PersonalCard("Calendar isn't connected for this account", "Connect its Calendar permission in Control Center, or choose a different account.") }
                    else {
                        item { OutlinedButton(onClick = { run { calendars = request("GET", path("calendars"), null).objects("items") } }, enabled = !busy) { Text("Choose from my calendars") } }
                        item { PersonalChoice("Calendar", calendars.find { it.optString("id") == calendarId }?.optString("summary") ?: "Primary calendar", listOf("primary" to "Primary calendar") + calendars.map { it.optString("id") to it.optString("summary", it.optString("id")) }, !busy) { calendarId = it } }
                        item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { run { events = request("GET", path("events") + "?calendarId=${Uri.encode(calendarId)}", null).objects("items"); loaded = true } }, enabled = !busy) { Text("Upcoming events") }
                            OutlinedButton(onClick = { compose = "event" }, enabled = !busy) { Text("Add event") }
                        } }
                        if (loaded && events.isEmpty()) item { PersonalCard("Nothing coming up", "No upcoming events were returned for this calendar.") }
                        items(events) { event -> PersonalCard(event.optString("summary", "Untitled event"), "${eventDate(event.optJSONObject("start"))} – ${eventDate(event.optJSONObject("end"))}" + event.optString("location").takeIf { it.isNotBlank() }?.let { "\n$it" }.orEmpty()) }
                    }
                }
            }
        }
    }
    if (compose.isNotBlank()) AlertDialog(onDismissRequest = { if (!busy) compose = "" }, title = { Text(if (compose == "email") "Write an email" else "Add a calendar event") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Account: ${selected?.optString("email")}", fontWeight = FontWeight.Bold)
            if (compose == "email") {
                OutlinedTextField(to, { to = it }, label = { Text("To · one email address") }, singleLine = true, enabled = !busy)
                OutlinedTextField(subject, { subject = it }, label = { Text("Subject") }, singleLine = true, enabled = !busy)
                OutlinedTextField(body, { body = it }, label = { Text("Your exact message") }, minLines = 4, enabled = !busy)
                Text("Send submits this email as the account above. If ordinary-action confirmation is enabled on your PC, it waits for desktop approval.", style = MaterialTheme.typography.bodySmall)
            } else {
                Text("Calendar: ${calendars.find { it.optString("id") == calendarId }?.optString("summary") ?: "Primary calendar"}")
                OutlinedTextField(title, { title = it }, label = { Text("Event title") }, enabled = !busy)
                OutlinedTextField(start, { start = it }, label = { Text("Start · date, time and timezone") }, enabled = !busy)
                OutlinedTextField(end, { end = it }, label = { Text("End · date, time and timezone") }, enabled = !busy)
                Text("Example: 2026-09-30T14:00:00+01:00. The timezone offset is required.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(location, { location = it }, label = { Text("Location · optional") }, enabled = !busy)
                OutlinedTextField(detail, { detail = it }, label = { Text("Notes · optional") }, enabled = !busy)
                Text("Creates an event in the selected calendar. No invitations are sent. Your PC's ordinary-action approval setting applies.", style = MaterialTheme.typography.bodySmall)
            }
            if (feedback.isNotBlank()) Text(feedback, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
            if (busy) NakamaBusy(Modifier.fillMaxWidth())
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = {
        val kind = compose
        try {
            if (kind == "email") GoogleForms.email(to.trim(), subject, body) else GoogleForms.event(title, start.trim(), end.trim())
            val payload = if (kind == "email") JSONObject().put("to", to.trim()).put("subject", subject).put("body", body)
                else JSONObject().put("calendarId", calendarId).put("summary", title).put("start", start.trim()).put("end", end.trim()).put("description", detail).put("location", location)
            run(write = true) {
                val result = request("POST", path(if (kind == "email") "send-email" else "create-event"), payload)
                feedback = if (result.optBoolean("completed")) {
                    if (kind == "email") "Google accepted your email. Recipient delivery is not verified." else "Google confirmed that your calendar event was created."
                } else "Request submitted to Control Center. Review its desktop approval before it can complete."
                compose = ""
                if (kind == "email") { to = ""; subject = ""; body = "" } else { title = ""; detail = ""; location = "" }
            }
        } catch (error: IllegalArgumentException) { feedback = error.message.orEmpty() }
    }) { Text(if (compose == "email") "Send email" else "Create event") } }, dismissButton = { TextButton(onClick = { compose = "" }, enabled = !busy) { Text("Cancel") } })
}

@Composable private fun PersonalCard(title: String, text: String) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(title, fontWeight = FontWeight.SemiBold); Text(text, style = MaterialTheme.typography.bodyMedium) } }
}
@Composable private fun PersonalChoice(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean, onChoose: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Column(Modifier.weight(1f)) { Text(label, style = MaterialTheme.typography.labelSmall); Text(value) }; Text("⌄") }
        DropdownMenu(expanded, { expanded = false }) { options.distinctBy { it.first }.forEach { (id, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { expanded = false; onChoose(id) }) } }
    }
}
private fun eventDate(value: JSONObject?): String {
    val date = value?.optString("dateTime").orEmpty().ifBlank { value?.optString("date").orEmpty() }
    return runCatching { OffsetDateTime.parse(date).format(DateTimeFormatter.ofPattern("d MMM, HH:mm xxx")) }.getOrDefault(date)
}
