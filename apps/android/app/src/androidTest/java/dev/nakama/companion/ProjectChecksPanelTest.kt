package dev.nakama.companion

import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Drives the actual Compose panel through Android accessibility, without extra UI-test dependencies. */
@RunWith(AndroidJUnit4::class)
class ProjectChecksPanelTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    private fun await(message: String, predicate: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) {
            if (predicate()) return
            SystemClock.sleep(100)
        }
        fail(message)
    }

    private fun nodes(): List<AccessibilityNodeInfo> {
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return emptyList()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        val found = mutableListOf<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty() && found.size < 1000) {
            val node = queue.removeFirst()
            found.add(node)
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return found
    }

    private fun visible(text: String): Boolean = nodes().any {
        it.isVisibleToUser && (it.text?.toString()?.contains(text) == true || it.contentDescription?.toString()?.contains(text) == true)
    }

    private fun click(text: String) {
        await("Expected clickable control: $text") {
            var node = nodes().firstOrNull { it.isVisibleToUser && (it.text?.toString() == text || it.contentDescription?.toString() == text) }
            repeat(8) {
                if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node = node?.parent
            }
            false
        }
    }

    private fun scrollTo(text: String) {
        repeat(12) {
            if (visible(text)) return
            nodes().firstOrNull { it.isVisibleToUser && it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            SystemClock.sleep(180)
        }
        assertTrue("Expected visible text after scrolling: $text", visible(text))
    }

    private fun showPanel(
        identity: MutableState<HostIdentity?>,
        state: MutableState<JSONObject>,
        project: MutableState<String>,
        request: suspend (HostIdentity, String, String, JSONObject?) -> JSONObject,
        refresh: suspend (HostIdentity) -> Unit = {},
    ): MainActivity {
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        instrumentation.runOnMainSync {
            activity.setContent {
                MaterialTheme {
                    Surface(Modifier.fillMaxSize()) {
                        ProjectChecksPanel(identity.value, state.value, true, project.value, request, refresh) {}
                    }
                }
            }
        }
        await("Project-check panel did not render") { visible("Project checks") }
        return activity
    }

    @Test fun renderedPanelLoadsLifecycleAndRequestsExactlyOneDesktopApproval() {
        val fixture = projectCheckFixture()
        val paired = pairProjectCheckFixture(fixture, "checksUiTicket")
        val client = HostClient(paired)
        val projectId = fixture.getJSONObject("checksFixture").getString("projectId")
        val before = client.request("GET", "/api/state")
        val state = mutableStateOf(before)
        val posts = AtomicInteger()
        val activity = showPanel(mutableStateOf<HostIdentity?>(paired), state, mutableStateOf(projectId), { identity, method, route, body ->
            if (method == "POST") posts.incrementAndGet()
            withContext(Dispatchers.IO) { HostClient(identity).request(method, route, body) }
        }, {
            state.value = withContext(Dispatchers.IO) { client.request("GET", "/api/state") }
        })
        try {
            click("Refresh checks")
            await("Lifecycle preview did not load") { visible("node fixture-pre.cjs") && visible("node fixture-test.cjs") && visible("node fixture-post.cjs") }
            scrollTo("Request test approval")
            click("Request test approval")
            await("The request should stop at desktop approval") { visible("Awaiting desktop approval") || visible("Request sent for desktop approval") }
            SystemClock.sleep(250)
            assertEquals("The panel must not retry a POST automatically", 1, posts.get())
            val after = client.request("GET", "/api/state")
            val approvals = after.objects("approvals").filter { it.optString("requestedBy") == paired.deviceId && it.optString("type") == "project_check" }
            assertEquals(1, approvals.size)
            assertEquals("pending", approvals.single().getString("status"))
            assertEquals(before.objects("tasks").map { it.getString("id") }.toSet(), after.objects("tasks").map { it.getString("id") }.toSet())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    private val fakeIdentity = HostIdentity("https://example.test:43110", "a".repeat(64), "fixture-token", "fixture-device", "Fixture")
    private fun fakeState(google: Boolean = true, projects: Boolean = true) = JSONObject()
        .put("devices", JSONArray().put(JSONObject().put("id", fakeIdentity.deviceId).put("permissions", JSONObject().put("projectAccess", projects).put("googleAccess", google))))
        .put("projects", JSONArray().put(JSONObject().put("id", "project-one").put("name", "First fixture project")).put(JSONObject().put("id", "project-two").put("name", "Second fixture project")))
        .put("tasks", JSONArray().put(JSONObject().put("id", "private-task").put("projectId", "project-one").put("kind", "project_check").put("checkName", "test")
            .put("title", "PRIVATE HISTORY FIXTURE").put("status", "completed").put("exitCode", 0).put("output", "Fixture output only")))
    private fun catalogue(script: String) = JSONObject().put("supported", true).put("manifestHash", "a".repeat(64)).put("runtime", JSONObject().put("available", true))
        .put("checks", JSONArray().put(JSONObject().put("name", "test").put("script", script)))

    @Test fun lateDiscoveryFromOldProjectAndPairingCannotRenderInNewScope() {
        val identity = mutableStateOf<HostIdentity?>(fakeIdentity)
        val project = mutableStateOf("project-one")
        val replies = CopyOnWriteArrayList<CompletableDeferred<JSONObject>>()
        val activity = showPanel(identity, mutableStateOf(fakeState()), project, { _, method, _, _ ->
            check(method == "GET")
            CompletableDeferred<JSONObject>().also(replies::add).await()
        })
        try {
            click("Refresh checks")
            await("First request was not captured") { replies.size == 1 }
            instrumentation.runOnMainSync {
                identity.value = fakeIdentity.copy(token = "new-fixture-token")
                project.value = "project-two"
            }
            await("The new project did not render") { visible("Second fixture project") }
            replies[0].complete(catalogue("STALE SCOPE MUST NOT RENDER"))
            click("Refresh checks")
            await("Second request was not captured") { replies.size == 2 }
            replies[1].complete(catalogue("CURRENT SCOPE PREVIEW"))
            await("Current-scope result should render") { visible("CURRENT SCOPE PREVIEW") }
            assertFalse("Old project/pairing data leaked", visible("STALE SCOPE MUST NOT RENDER"))
        } finally { replies.forEach { it.cancel() }; instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun googleAndProjectPermissionRemovalClearRenderedHistoryAndPreviews() {
        val state = mutableStateOf(fakeState())
        val replies = CopyOnWriteArrayList<CompletableDeferred<JSONObject>>()
        val activity = showPanel(mutableStateOf<HostIdentity?>(fakeIdentity), state, mutableStateOf("project-one"), { _, _, _, _ ->
            CompletableDeferred<JSONObject>().also(replies::add).await()
        })
        try {
            scrollTo("PRIVATE HISTORY FIXTURE")
            assertTrue(visible("PRIVATE HISTORY FIXTURE"))
            instrumentation.runOnMainSync { state.value = fakeState(google = false) }
            scrollTo("History is hidden for this device")
            assertFalse(visible("PRIVATE HISTORY FIXTURE"))
            // Reset only the test parent's permission state, then exercise a late response
            // crossing project-access removal in the real panel.
            instrumentation.runOnMainSync { state.value = fakeState() }
            repeat(12) { nodes().firstOrNull { it.isVisibleToUser && it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) }
            click("Refresh checks")
            await("Discovery request was not captured") { replies.size == 1 }
            instrumentation.runOnMainSync { state.value = fakeState(projects = false) }
            await("Project access removal did not hide the panel") { visible("Project access is unavailable") }
            replies[0].complete(catalogue("FORBIDDEN LATE PREVIEW"))
            SystemClock.sleep(250)
            assertFalse(visible("FORBIDDEN LATE PREVIEW"))
            assertFalse(visible("PRIVATE HISTORY FIXTURE"))
            assertFalse(visible("Request test approval"))
        } finally { replies.forEach { it.cancel() }; instrumentation.runOnMainSync { activity.finish() } }
    }
}
