package dev.nakama.companion

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

object InstalledApps {
    fun launchable(context: Context): List<InstalledApp> {
        val manager = context.packageManager
        return InstalledAppPolicy.normalize(manager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo?.exported == true && it.activityInfo.enabled && it.activityInfo.applicationInfo.enabled }
            .map { InstalledApp(it.activityInfo.packageName, it.loadLabel(manager).toString()) })
    }
    fun label(context: Context, target: String): String = runCatching {
        launchable(context).find { it.packageName == target }?.label
    }.getOrNull() ?: "Selected app (unavailable)"
    fun contains(context: Context, target: String): Boolean = runCatching { InstalledAppPolicy.selected(launchable(context), target) }.getOrDefault(false)
    private val syncMutex = Mutex()
    private var lastIdentity: HostIdentity? = null
    private var lastAttempt = 0L
    suspend fun sync(context: Context, identity: HostIdentity) = syncMutex.withLock {
        val now = SystemClock.elapsedRealtime()
        if (lastIdentity == identity && now - lastAttempt in 0 until 30_000) return@withLock
        lastIdentity = identity; lastAttempt = now
        try {
            withContext(Dispatchers.IO) {
                if (PairingVault(context).load() != identity) return@withContext
                val apps = JSONArray().apply { launchable(context).forEach { put(JSONObject().put("packageName", it.packageName).put("label", it.label)) } }
                if (PairingVault(context).load() == identity) HostClient(identity).request("POST", "/api/device/apps", JSONObject().put("apps", apps))
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* An older/offline host cannot block ordinary device actions. */ }
    }
}

@Composable
fun InstalledAppPicker(label: String, selectedPackage: String, enabled: Boolean = true,
    controlOnly: Boolean = false, appSource: (Context) -> List<InstalledApp> = InstalledApps::launchable,
    onSelected: (String) -> Unit) {
    val context = LocalContext.current
    val activity = LocalActivity.current as? ComponentActivity
    val scope = rememberCoroutineScope()
    var apps by remember { mutableStateOf<List<InstalledApp>>(emptyList()) }
    var expanded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    suspend fun refresh() {
        loading = true
        try {
            val found = withContext(Dispatchers.IO) { InstalledAppPolicy.normalize(appSource(context)) }
            apps = if (controlOnly) found.filter { MonitorPolicy.packageAllowed(it.packageName) } else found
            error = ""
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { apps = emptyList(); error = "Could not read installed apps. Try again." }
        finally { loading = false }
    }
    LaunchedEffect(controlOnly) { refresh() }
    DisposableEffect(activity, controlOnly) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) scope.launch { refresh() }
            if (event == Lifecycle.Event.ON_PAUSE) expanded = false
        }
        activity?.lifecycle?.addObserver(observer)
        onDispose { activity?.lifecycle?.removeObserver(observer) }
    }
    val selected = apps.find { it.packageName == selectedPackage }
    Column(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(enabled = enabled && !loading, modifier = Modifier.fillMaxWidth(), onClick = { scope.launch { refresh(); expanded = true } }) {
                Text(if (loading) "Loading apps…" else selected?.let { InstalledAppPolicy.choiceLabel(it, apps) } ?: "Choose an installed app")
            }
            DropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }, modifier = Modifier.heightIn(max = 320.dp)) {
                apps.forEach { app -> DropdownMenuItem(text = { Text(InstalledAppPolicy.choiceLabel(app, apps)) }, onClick = { onSelected(app.packageName); expanded = false }) }
                if (apps.isEmpty()) DropdownMenuItem(text = { Text("No eligible launchable apps found") }, onClick = { expanded = false }, enabled = false)
            }
        }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        else if (selectedPackage.isNotBlank() && selected == null && !loading) Text("The previous app is unavailable. Choose an installed app.", style = MaterialTheme.typography.bodySmall)
    }
}
