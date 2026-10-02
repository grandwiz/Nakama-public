package dev.nakama.companion

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.*
import org.json.JSONObject

/** Office previews never include a private, human-controlled or previously tainted session. */
@Composable
fun officeBrowserFrame(session: JSONObject?, allowed: Boolean, request: (suspend (String, String, JSONObject?) -> JSONObject)?): Bitmap? {
    val activity = LocalActivity.current as? ComponentActivity
    var active by remember { mutableStateOf(activity?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) }
    var picture by remember { mutableStateOf<Bitmap?>(null) }
    val permitted = allowed && session != null && session.optString("mode") == "project" && !session.optBoolean("tainted") && session.optJSONObject("controller") == null && session.optString("status") !in listOf("closed", "error")
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) { active = false; picture = null } else if (event == Lifecycle.Event.ON_RESUME) active = true }
        activity?.lifecycle?.addObserver(observer); onDispose { activity?.lifecycle?.removeObserver(observer) }
    }
    LaunchedEffect(permitted, active, session?.optString("id"), session?.optString("activeTabId")) {
        picture = null
        if (!permitted || !active || request == null) return@LaunchedEffect
        val id = session!!.optString("id"); val tab = session.optString("activeTabId")
        if (!BrowserInputPolicy.id(id) || !BrowserInputPolicy.id(tab)) return@LaunchedEffect
        while (isActive) {
            try { val frame = request("POST", "/api/browser-studio/sessions/$id/frame", JSONObject().put("tabId", tab)); picture = withContext(Dispatchers.Default) { BrowserInputPolicy.image(frame) } }
            catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { picture = null }
            delay(1800)
        }
    }
    return picture.takeIf { permitted && active }
}
