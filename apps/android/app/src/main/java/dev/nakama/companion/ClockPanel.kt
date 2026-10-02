package dev.nakama.companion

import android.app.AlarmManager
import android.app.NotificationManager
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Optional synthetic engine/clock keep UI tests separate from Android's real alarm registrations. */
@Composable
fun ClockPanel(localAction: (String) -> Unit, fixtureEngine: LocalTimerEngine? = null, fixtureClock: (() -> TimerMoment)? = null) {
    val context = LocalContext.current
    fun read() = fixtureEngine?.snapshot() ?: LocalTimers.snapshot(context)
    fun moment() = fixtureClock?.invoke() ?: LocalTimers.moment(context)
    var now by remember { mutableStateOf(moment()) }
    var timers by remember { mutableStateOf(read()) }
    var hours by remember { mutableStateOf("0") }
    var minutes by remember { mutableStateOf("10") }
    var seconds by remember { mutableStateOf("0") }
    var title by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf("") }
    val hour = hours.toLongOrNull(); val minute = minutes.toLongOrNull(); val second = seconds.toLongOrNull()
    val duration = if (hour != null && minute != null && second != null && hour in 0L..168L && minute in 0L..59L && second in 0L..59L) hour * 3600 + minute * 60 + second else 0L
    LaunchedEffect(fixtureEngine) { while (true) { now = moment(); timers = read(); delay(500) } }
    fun change(timer: LocalTimer, action: String) {
        receipt = runCatching {
            LocalClockActions.result(fixtureEngine?.change(timer.id, timer.revision, action) ?: LocalTimers.change(context, timer.id, timer.revision, action)).text
        }.getOrElse { it.message ?: "This timer could not be changed." }
        timers = read(); now = moment()
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Text("Clock", style = MaterialTheme.typography.headlineSmall)
            Text(SimpleDateFormat(if (android.text.format.DateFormat.is24HourFormat(context)) "HH:mm:ss" else "h:mm:ss a", Locale.getDefault()).format(Date(now.wallMillis)), style = MaterialTheme.typography.displayMedium)
            Text(SimpleDateFormat("EEEE, d MMMM · z", Locale.getDefault()).format(Date(now.wallMillis)), style = MaterialTheme.typography.bodyMedium)
            Text("This phone · works offline", style = MaterialTheme.typography.labelLarge)
        }
        item {
            Text("Phone timers", style = MaterialTheme.typography.titleLarge)
            Text("Timers stay on this device and run independently of your PC. Existing synced routine alarms remain in Routines.", style = MaterialTheme.typography.bodySmall)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(hours, { hours = it.filter(Char::isDigit).take(3) }, label = { Text("Hours") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(2) }, label = { Text("Minutes") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                OutlinedTextField(seconds, { seconds = it.filter(Char::isDigit).take(2) }, label = { Text("Seconds") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(1, 5, 10, 25).forEach { preset -> AssistChip(onClick = { hours = "0"; minutes = preset.toString(); seconds = "0" }, label = { Text("$preset min") }) }
            }
            OutlinedTextField(title, { title = it.take(80).replace("\n", " ") }, label = { Text("Timer name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(enabled = duration in 1..604_800, onClick = {
                receipt = runCatching { LocalClockActions.result(fixtureEngine?.create(duration, title) ?: LocalTimers.create(context, duration, title)).text }
                    .getOrElse { it.message ?: "The timer could not be saved." }
                timers = read(); now = moment()
            }, modifier = Modifier.padding(top = 8.dp)) { Text("Start phone timer") }
        }
        item {
            val notifications = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
            val exact = context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
            if (!notifications || !exact) Text("A missing permission saves new timers paused. After granting it, tap Resume on the saved timer.", style = MaterialTheme.typography.bodySmall)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (!notifications) OutlinedButton(onClick = { localAction("timer_notifications") }) { Text("Allow notifications") }
                if (!exact) OutlinedButton(onClick = { localAction("timer_alarm_permission") }) { Text("Alarms & reminders") }
                TextButton(onClick = { localAction("timer_alert_settings") }) { Text("Timer alert settings") }
            }
            Text("Alarm volume, notification settings and Do Not Disturb affect sound. Deadlines restore after a phone restart or reopening Nakama after force-stop; a powered-off phone cannot ring.", style = MaterialTheme.typography.bodySmall)
        }
        if (receipt.isNotBlank()) item { Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) { Text(receipt, Modifier.padding(12.dp)) } }
        val current = timers.filter { it.status in LocalTimerPolicy.active }.sortedBy { if (it.status == "finished") 0 else 1 }
        if (current.isEmpty()) item { Text("No active phone timers. Try saying: set a ten minute timer.") }
        items(current, key = { it.id }) { timer ->
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.large) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(timer.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(LocalTimerPolicy.display(LocalTimerPolicy.remaining(timer, now)), style = MaterialTheme.typography.displaySmall)
                    Text(if (timer.status == "finished") "Finished on this phone" else timer.status.replaceFirstChar(Char::uppercase), style = MaterialTheme.typography.labelLarge)
                    if (timer.issue.isNotBlank()) Text(timer.issue + if (timer.status == "paused") " Tap Resume after fixing the permission." else "", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (timer.status == "running") OutlinedButton(onClick = { change(timer, "pause") }) { Text("Pause") }
                        if (timer.status == "paused") Button(onClick = { change(timer, "resume") }) { Text("Resume") }
                        if (timer.status == "finished") Button(onClick = { change(timer, "dismiss") }) { Text("Stop timer") }
                        else TextButton(onClick = { change(timer, "cancel") }) { Text("Cancel timer") }
                    }
                }
            }
        }
        val history = timers.filterNot { it.status in LocalTimerPolicy.active }.takeLast(5).reversed()
        if (history.isNotEmpty()) item { Text("Recent phone timers", style = MaterialTheme.typography.titleMedium) }
        items(history, key = { "history:" + it.id }) { timer -> Text("${timer.title} · ${LocalTimerPolicy.duration(timer.durationMillis)} · ${timer.status}", style = MaterialTheme.typography.bodySmall) }
    }
}
