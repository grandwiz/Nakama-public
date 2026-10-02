package dev.nakama.companion

import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MotionSkillsGithubTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val pending = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(pending::add)
        while (pending.isNotEmpty() && result.size < 1000) { val node = pending.removeFirst(); result += node; repeat(node.childCount) { node.getChild(it)?.let(pending::add) } }
        return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < until) { if (condition()) return; SystemClock.sleep(80) }; fail(message + ": " + nodes().mapNotNull { it.text?.toString() }.joinToString(" | "))
    }
    private fun click(label: String) = await("Missing control $label") {
        var node = nodes().firstOrNull { it.text?.toString() == label || it.contentDescription?.toString() == label }
        repeat(8) { if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK); node = node?.parent }; false
    }
    private fun text(index: Int, value: String) = await("Missing editable $index") {
        nodes().filter { it.isEditable }.getOrNull(index)?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }) == true
    }
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun screenshot(name: String) {
        SystemClock.sleep(250)
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
    }
    @Test fun candidatesRequireAcceptanceAndPrivateLibraryDisappears() {
        val activity = activity(); val allowed = mutableStateOf(true); val calls = mutableListOf<String>()
        val library = JSONObject("""{"version":1,"learningEnabled":true,"reuseEnabled":true,"skills":[{"id":"fixture","title":"Check a garden plan","description":"A repeatable fixture review","whenToUse":"Before reviewing a garden design","steps":["Read the requested requirements","Check each agreed constraint"],"tags":["review"],"enabled":false,"status":"candidate","source":{"kind":"reviewed_workflow","detail":"Synthetic completed review","workflowId":"fixture-workflow"},"useCount":0}],"receipts":[]}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { NakamaMotion(false) { Box(Modifier.safeDrawingPadding()) { SkillsPanel("fixture-phone", allowed.value, null, { method, path, _ ->
                calls += "$method $path"
                if (path.endsWith("/accept")) library.getJSONArray("skills").getJSONObject(0).put("status", "ready").put("enabled", true)
                library
            }, {}) } } } } }
            click("Review Check a garden plan")
            await("Candidate disclosure missing") { nodes().any { it.text?.toString() == "This candidate is not reused until you accept it." } }
            assertTrue(calls.none { it.startsWith("PATCH") })
            click("Accept for reuse")
            await("Acceptance not recorded") { calls.contains("POST /api/skills/fixture/accept") && nodes().any { it.text?.toString() == "ready" } }
            screenshot("learned-skills.png")
            instrumentation.runOnMainSync { allowed.value = false }
            await("Private library survived revoked access") { nodes().none { it.text?.toString() == "Check a garden plan" } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun lateSkillResponseCannotRestoreRevokedData() {
        val activity = activity(); val allowed = mutableStateOf(true); val reply = CompletableDeferred<JSONObject>(); var requested = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { SkillsPanel("fixture-phone", allowed.value, null, { _, _, _ -> requested = true; reply.await() }, {}) } } } }
            await("No skill fetch") { requested }
            instrumentation.runOnMainSync { allowed.value = false; reply.complete(JSONObject("""{"version":1,"skills":[{"id":"late","title":"Late secret fixture"}]}""")) }
            await("Missing privacy notice") { nodes().any { it.text?.toString()?.contains("enable Google and project access") == true } }
            assertTrue(nodes().none { it.text?.toString()?.contains("Late secret") == true })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun githubPushPreviewRequestsPcApprovalAndNeverApprovesOnPhone() {
        val activity = activity(); val allowed = mutableStateOf(true); val calls = mutableListOf<Pair<String, JSONObject?>>()
        val state = JSONObject("""{"connections":[{"id":"github","accounts":[{"id":"fixture-account","name":"Fixture developer","status":"connected"}]}]}""")
        val repo = JSONObject("""{"linked":true,"link":{"accountId":"fixture-account","accountLabel":"Fixture developer","repository":"fixture/garden","defaultBranch":"main"},"status":{"available":true,"repository":true,"branch":"feature/garden","head":"1111111111111111111111111111111111111111","entries":[],"ahead":1,"behind":0,"truncated":false},"busy":false}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { NakamaMotion(false) { Box(Modifier.safeDrawingPadding()) { GithubProjectPanel("fixture-project", state, allowed.value, { method, path, body ->
                calls += "$method $path" to body
                when {
                    path.endsWith("push/prepare") -> JSONObject("""{"id":"fixture-preview","branch":"feature/garden","head":"1111111111111111111111111111111111111111","remoteHead":"2222222222222222222222222222222222222222","expiresAt":"fixture expiry","disclosure":"May trigger repository automation."}""")
                    path.endsWith("/push") -> JSONObject("""{"approval":{"id":"fixture-approval","status":"pending"}}""")
                    else -> repo
                }
            }, {}, {}) } } } } }
            click("Review push")
            await("Preview head absent") { nodes().any { it.text?.toString()?.contains("1111111111111111111111111111111111111111") == true } }
            assertTrue(calls.none { it.first.endsWith("/push") })
            click("Request PC approval")
            await("PC approval receipt absent") { nodes().any { it.text?.toString()?.contains("This is not a completed push.") == true } }
            assertEquals("fixture-preview", calls.first { it.first.endsWith("/push") }.second?.optString("previewId"))
            assertTrue(calls.none { it.first.contains("/approvals/") })
            screenshot("github-project.png")
            instrumentation.runOnMainSync { allowed.value = false }
            await("Repository survived revoked access") { nodes().none { it.text?.toString() == "fixture/garden" } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun githubImportUsesSelectedNamedAccountAndExactRepository() {
        val activity = activity(); val calls = mutableListOf<JSONObject>()
        val state = JSONObject("""{"connections":[{"id":"github","accounts":[{"id":"fixture-account","name":"Fixture developer","status":"connected"}]}]}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { GithubProjectPanel(null, state, true, { method, path, body ->
                assertEquals("POST", method); assertEquals("/api/github/import", path); calls += body!!; JSONObject().put("project", JSONObject().put("id", "imported-fixture"))
            }, {}, {}) } } } }
            click("Fixture developer · connected"); text(0, "fixture/garden"); text(1, "Garden fixture"); click("Import repository")
            await("Import not sent") { calls.isNotEmpty() }
            assertEquals("fixture-account", calls.single().optString("accountId")); assertEquals("fixture/garden", calls.single().optString("repository"))
            assertEquals("Garden fixture", calls.single().optString("name"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun githubCommitReviewsOnlySelectedFilesAndKeepsDraftAfterStaleRejection() {
        val activity = activity(); val calls = mutableListOf<Pair<String, JSONObject?>>()
        val repo = JSONObject("""{"linked":false,"status":{"available":true,"branch":"main","head":"1111111111111111111111111111111111111111","entries":[{"path":"note.txt","indexStatus":" ","worktreeStatus":"M"}],"truncated":false},"busy":false}""")
        // Linked avoids unrelated account controls in this focused synthetic fixture.
        repo.put("linked", true).put("link", JSONObject().put("repository", "fixture/garden").put("accountLabel", "Fixture developer"))
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { GithubProjectPanel("fixture-project", JSONObject(), true, { method, path, body ->
                calls += "$method $path" to body
                when {
                    path.endsWith("commit/prepare") -> JSONObject("""{"id":"fixture-commit-preview","branch":"main","head":"1111111111111111111111111111111111111111","message":"Improve fixture notes","authorName":"Fixture User","authorEmail":"fixture@example.invalid","files":[{"path":"note.txt","kind":"modified","bytes":12,"before":"Old fixture notes","after":"New fixture notes"}],"expiresAt":"fixture expiry"}""")
                    path.endsWith("/commit") -> throw IllegalStateException("The reviewed Git state changed. Refresh and prepare a new review.")
                    else -> repo
                }
            }, {}, {}) } } } }
            await("Missing changed-path checkbox") { nodes().firstOrNull { it.isCheckable && !it.isChecked }?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true }
            click("Prepare commit · 1 paths"); text(0, "Improve fixture notes"); text(1, "Fixture User"); text(2, "fixture@example.invalid"); click("Review exact commit")
            await("Exact file review missing") { nodes().any { it.text?.toString()?.contains("note.txt\nmodified") == true } }
            assertTrue(nodes().any { it.text?.toString() == "New fixture notes" })
            click("Before")
            await("Original file not reviewable") { nodes().any { it.text?.toString() == "Old fixture notes" } }
            assertEquals("note.txt", calls.first { it.first.endsWith("commit/prepare") }.second?.getJSONArray("paths")?.getString(0))
            assertTrue(calls.none { it.first.endsWith("/commit") })
            click("Create local commit")
            await("Stale review rejection missing") { nodes().any { it.text?.toString()?.contains("reviewed Git state changed") == true } }
            assertTrue(nodes().any { it.text?.toString() == "Improve fixture notes" })
            assertTrue(nodes().none { it.text?.toString()?.contains("Commit recorded on your PC") == true })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun motionDoesNotRetainOutgoingPrivatePagesOrResetParentDrafts() {
        val activity = activity(); val page = mutableStateOf("Private fixture"); val reduced = mutableStateOf(false); var disposed = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { NakamaMotion(reduced.value) {
                var draft by remember { mutableStateOf("Keep my unsent draft") }
                Column(Modifier.fillMaxSize().safeDrawingPadding()) { OutlinedTextField(draft, { draft = it }); MotionPage(page.value, Modifier.weight(1f).fillMaxWidth()) {
                    if (page.value == "Private fixture") { DisposableEffect(Unit) { onDispose { disposed = true } }; Text("Private fixture") } else Text("Public fixture")
                } }
            } } } }
            await("Private page missing") { nodes().any { it.text?.toString() == "Private fixture" } }
            instrumentation.runOnMainSync { page.value = "Public fixture"; reduced.value = true }
            await("Outgoing page retained") { disposed && nodes().none { it.text?.toString() == "Private fixture" } }
            assertTrue(nodes().any { it.text?.toString() == "Keep my unsent draft" })
            assertTrue(nodes().any { it.text?.toString() == "Public fixture" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
