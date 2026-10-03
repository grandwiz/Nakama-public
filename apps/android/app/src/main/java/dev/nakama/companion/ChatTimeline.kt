package dev.nakama.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

data class ChatSubmission(val id: String, val text: String)

internal val finishedChatWork = setOf("completed", "failed", "cancelled", "canceled", "interrupted", "stopped", "denied", "error", "unavailable")

@Composable
fun ChatMessageBubble(message: JSONObject, onLookup: (String) -> Unit = {}) {
    var showTime by remember(message.optString("id")) { mutableStateOf(false) }
    val stamp = remember(message.optString("createdAt")) {
        runCatching { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(Instant.parse(message.optString("createdAt"))) }.getOrDefault("Time not recorded")
    }
    val mine = message.optString("role") == "user"
    Surface(shape = RoundedCornerShape(18.dp), color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(start = if (mine) 30.dp else 0.dp, end = if (mine) 0.dp else 20.dp)
            .clickable(onClickLabel = if (showTime) "Hide message timestamp" else "Show message timestamp") { showTime = !showTime }
            .semantics { stateDescription = if (showTime) "Timestamp shown" else "Timestamp hidden" }) {
        Column(Modifier.padding(15.dp)) {
            Text(if (mine) "YOU" else "NAKAMA", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            if (message.optInt("parts", 1) > 1) Text("Message part ${message.optInt("part")} of ${message.optInt("parts")}", style = MaterialTheme.typography.labelSmall)
            Text(message.optString("content"), Modifier.padding(top = 5.dp), style = MaterialTheme.typography.bodyMedium)
            if (showTime) Text(stamp, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelSmall)
            val lookup = message.optJSONObject("localOutcome")?.optString("url").orEmpty()
            val link = runCatching { java.net.URI(lookup) }.getOrNull()
            if (!mine && link?.scheme == "https" && link.rawUserInfo == null && link.host in listOf("www.google.com", "maps.google.com", "google.com", "www.openstreetmap.org")) TextButton(onClick = { onLookup(lookup) }) { Text("Open lookup or map") }
        }
    }
}

/** User scrolling owns the viewport until a new user submission or an explicit jump to latest. */
@Composable
fun ChatTimeline(messages: List<JSONObject>, conversationKey: String, submission: ChatSubmission?, modifier: Modifier = Modifier,
    prefixCount: Int = 0, suffixCount: Int = 0, focusPrefix: Boolean = false,
    prefix: LazyListScope.() -> Unit = {}, suffix: LazyListScope.() -> Unit = {}, onLookup: (String) -> Unit = {}) {
    val list = remember(conversationKey) { LazyListState() }
    val scope = rememberCoroutineScope()
    val visible = messages.filter { !it.optBoolean("deliveryOnly") }.takeLast(80)
    val signature = visible.joinToString("|") { it.optString("id") }
    var seen by remember(conversationKey) { mutableStateOf<Set<String>?>(null) }
    var lastSubmission by remember(conversationKey) { mutableStateOf<String?>(null) }
    var pending by remember(conversationKey) { mutableStateOf<Pair<ChatSubmission, Set<String>>?>(null) }
    var following by remember(conversationKey) { mutableStateOf(true) }
    var unread by remember(conversationKey) { mutableIntStateOf(0) }
    val itemCount = prefixCount + visible.size + suffixCount
    val away by remember(list) { derivedStateOf { list.canScrollForward } }
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress to list.canScrollForward }.collect { (scrolling, more) ->
            if (scrolling) following = !more
            if (!more) unread = 0
        }
    }
    LaunchedEffect(conversationKey, signature, submission?.id, prefixCount, suffixCount) {
        val ids = visible.map { it.optString("id") }.toSet()
        val prior = seen
        if (prior == null) {
            seen = ids; lastSubmission = submission?.id
            if (itemCount > 0) list.scrollToItem(if (focusPrefix) 0 else itemCount - 1)
            return@LaunchedEffect
        }
        if (submission != null && lastSubmission != submission.id) {
            lastSubmission = submission.id; pending = submission to prior
        }
        val own = pending?.let { (request, known) -> visible.indexOfLast { it.optString("role") == "user" && it.optString("id") !in known && it.optString("content").trim() == request.text.trim() }.takeIf { it >= 0 } }
        val added = ids.count { it !in prior }
        seen = ids
        if (own != null) {
            list.scrollToItem(prefixCount + own)
            pending = null; unread = 0; following = !list.canScrollForward
        } else if (following && itemCount > 0) {
            list.scrollToItem(itemCount - 1); unread = 0; following = true
        } else if (added > 0) unread += added
    }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxSize(), state = list, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(top = 12.dp, bottom = 56.dp)) {
            prefix()
            items(visible, key = { "message-${it.optString("id")}" }) { ChatMessageBubble(it, onLookup) }
            suffix()
        }
        if (away) FilledTonalButton(onClick = { scope.launch { if (itemCount > 0) list.scrollToItem(itemCount - 1); unread = 0; following = true } }, modifier = Modifier.align(Alignment.BottomStart).padding(8.dp)) {
            Text(if (unread > 0) "Latest · $unread unread" else "Latest message")
        }
    }
}
