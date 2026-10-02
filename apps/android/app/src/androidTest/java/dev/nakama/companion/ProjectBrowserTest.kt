package dev.nakama.companion

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.Base64

@RunWith(AndroidJUnit4::class)
class ProjectBrowserTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val pending = ArrayDeque<AccessibilityNodeInfo>(); val result = mutableListOf<AccessibilityNodeInfo>()
        instrumentation.uiAutomation.rootInActiveWindow?.let(pending::add)
        while (pending.isNotEmpty() && result.size < 1000) { val node = pending.removeFirst(); result += node; repeat(node.childCount) { node.getChild(it)?.let(pending::add) } }; return result
    }
    private fun await(message: String, condition: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 12_000
        while (SystemClock.uptimeMillis() < end) { if (condition()) return; SystemClock.sleep(80) }; fail(message + ": " + nodes().mapNotNull { it.text?.toString() }.joinToString(" | "))
    }
    private fun click(label: String) = await("Missing $label") {
        var node = nodes().firstOrNull { it.text?.toString() == label || it.contentDescription?.toString() == label }
        repeat(8) { if (node?.isClickable == true && node?.isEnabled == true) return@await node!!.performAction(AccessibilityNodeInfo.ACTION_CLICK); node = node?.parent }; false
    }
    private fun text(index: Int, value: String) = await("Missing editable $index") { nodes().filter { it.isEditable }.getOrNull(index)?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }) == true }
    private fun activity(): MainActivity {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        return instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
    }
    private fun screenshot(name: String) {
        SystemClock.sleep(250); instrumentation.uiAutomation.takeScreenshot()?.let { bitmap -> java.io.File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
    }
    private fun pdf(): ByteArray = ByteArrayOutputStream().use { bytes -> val document = PdfDocument(); try {
        val page = document.startPage(PdfDocument.PageInfo.Builder(480, 640, 1).create()); page.canvas.drawColor(Color.WHITE)
        page.canvas.drawText("Nakama project report", 30f, 55f, Paint().apply { textSize = 24f; color = Color.rgb(20, 90, 70) })
        page.canvas.drawText("Synthetic fixture - no deployment claimed", 30f, 95f, Paint().apply { textSize = 15f })
        document.finishPage(page); document.writeTo(bytes)
    } finally { document.close() }; bytes.toByteArray() }
    private fun binary(bytes: ByteArray) = JSONObject().put("fileName", "Garden-report.pdf").put("mimeType", "application/pdf").put("base64", Base64.getEncoder().encodeToString(bytes)).put("bytes", bytes.size).put("sha256", ProjectFilePolicy.hash(bytes))
    private fun picture(): String {
        val bitmap = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888); bitmap.eraseColor(Color.rgb(224, 242, 230)); val canvas = android.graphics.Canvas(bitmap)
        canvas.drawText("Garden preview", 45f, 70f, Paint().apply { color = Color.rgb(35, 80, 65); textSize = 35f })
        canvas.drawText("Synthetic host browser fixture", 45f, 115f, Paint().apply { color = Color.DKGRAY; textSize = 20f })
        return ByteArrayOutputStream().use { output -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle(); "data:image/png;base64," + Base64.getEncoder().encodeToString(output.toByteArray()) }
    }
    @Test fun projectFoldersTextAndIsolatedPdfPreviewUseScopedApis() {
        val activity = activity(); val allowed = mutableStateOf(true); val calls = mutableListOf<String>(); val data = binary(pdf())
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) { ProjectFilesPanel("fixture", "Garden project", allowed.value, { _, path, _ ->
                calls += path
                when {
                    path.endsWith("/reports/report/file") -> data
                    path.endsWith("/reports") -> JSONObject("""{"version":1,"available":true,"automaticEnabled":true,"busy":false,"reports":[{"id":"report","fileName":"Garden-report.pdf","status":"ready","createdAt":"Synthetic report"}]}""")
                    path.contains("/file?") -> JSONObject().put("content", "Garden fixture notes only")
                    path.endsWith("path=docs") -> JSONObject("""{"entries":[{"name":"notes.md","path":"docs/notes.md","type":"file"}]}""")
                    else -> JSONObject("""{"entries":[{"name":"docs","path":"docs","type":"directory"}]}""")
                }
            }, {}, {}) } } } }
            click("Folder · docs"); click("File · notes.md")
            await("Text preview missing") { nodes().any { it.text?.toString() == "Garden fixture notes only" } }; assertTrue(calls.any { it.endsWith("path=docs%2Fnotes%2Emd") })
            click("Close preview"); click("Reports"); click("Open PDF report")
            await("Isolated PDF not rendered") { nodes().any { it.text?.toString() == "1/1" } }; screenshot("project-pdf-preview.png")
            assertTrue(instrumentation.targetContext.cacheDir.listFiles().orEmpty().none { it.name.startsWith("nakama-pdf-") })
            instrumentation.runOnMainSync { allowed.value = false }
            await("PDF remained after revoked access") { nodes().none { it.text?.toString() == "Garden-report.pdf" } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun corruptPreviewChecksumAndMalformedPdfFailClosed() = runBlocking {
        val data = binary(pdf()).put("sha256", "0".repeat(64))
        assertTrue(runCatching { ProjectFilePolicy.binary(data) }.isFailure)
        val result = runCatching { ProjectPdfRenderer.render(instrumentation.targetContext, "%PDF-not a document".toByteArray(), 0) }
        assertTrue(result.isFailure)
        assertTrue(instrumentation.targetContext.cacheDir.listFiles().orEmpty().none { it.name.startsWith("nakama-pdf-") })
    }
    @Test fun browserTakeoverBindsInputToFreshFrameAndReleasesOnExit() {
        val activity = activity(); val calls = mutableListOf<Pair<String, JSONObject?>>(); val show = mutableStateOf(true); val img = picture(); var number = 0
        val session = JSONObject("""{"id":"browser-fixture","mode":"project","projectId":"garden","status":"ready","tainted":false,"activeTabId":"tab-one","tabs":[{"id":"tab-one","title":"Garden local preview"}]}""")
        val studio = JSONObject().put("available", true).put("permitted", true).put("sessions", JSONArray().put(session))
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) { if (show.value) BrowserStudioPanel("phone", true, emptyList(), "browser-fixture") { method, path, body ->
                calls += "$method $path" to body
                when {
                    path.endsWith("/takeover") -> { session.put("controller", JSONObject().put("kind", "device").put("id", "phone")).put("tainted", true).put("status", "human_control"); JSONObject().put("session", session) }
                    path.endsWith("/release") -> { session.remove("controller"); session.put("status", "attention"); JSONObject().put("session", session) }
                    path.endsWith("/frame") -> JSONObject().put("frameId", "frame-${++number}").put("image", img).put("sessionId", "browser-fixture").put("tabId", "tab-one").put("expiresAt", Instant.now().plusSeconds(3).toString()).put("capturedAt", "Synthetic live frame")
                    path.endsWith("/control") -> JSONObject().put("accepted", true)
                    else -> studio
                }
            } else Text("Browser left") } } } }
            await("Host frame missing") { nodes().any { it.contentDescription?.toString() == "Current host browser frame" } }
            screenshot("browser-studio.png"); assertTrue(calls.none { it.first.endsWith("/control") })
            click("Take human control"); await("Owned controls missing") { nodes().any { it.text?.toString() == "Release control" } }
            click("Keyboard"); click("Enter"); await("No frame-bound input") { calls.any { it.first.endsWith("/control") } }
            val control = calls.last { it.first.endsWith("/control") }.second!!; assertEquals("tab-one", control.optString("tabId")); assertTrue(control.optString("frameId").startsWith("frame-")); assertEquals("Enter", control.optString("key"))
            instrumentation.runOnMainSync { show.value = false }
            await("No release on disposal") { calls.any { it.first.endsWith("/release") } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun privateFramesAndUnknownAttentionAreDenied() {
        val session = JSONObject("""{"mode":"private","status":"human_control","controller":{"kind":"device","id":"other"}}""")
        assertFalse(BrowserInputPolicy.mayView(session, "phone")); assertTrue(BrowserInputPolicy.mayView(session, "other"))
        session.put("mode", "project").put("tainted", true).remove("controller"); assertFalse(BrowserInputPolicy.mayView(session, "phone"))
        assertFalse(BrowserInputPolicy.fresh(JSONObject().put("expiresAt", Instant.now().minusSeconds(1))))
        assertTrue(AttentionPolicy.notices(JSONObject("""{"version":99,"items":[{"id":"secret","kind":"question"}]}""")).isEmpty())
        val notices = AttentionPolicy.notices(JSONObject("""{"version":1,"items":[{"id":"request","kind":"login","title":"DO NOT COPY THIS SECRET","connectionRequestId":"handoff"}]}"""))
        assertEquals("handoff", notices.single().connectionRequestId); assertFalse(notices.toString().contains("SECRET"))
    }
    @Test fun sharedQuestionDictationIsReviewableAndCannotStopAnotherPhonesWork() {
        val activity = activity(); var sent: JSONObject? = null
        val workflow = JSONObject("""{"id":"shared","requestedBy":"different-phone","status":"awaiting_answers","stage":"awaiting_answers","questions":[{"id":"design","text":"Which design should we build?"}]}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { ProjectWorkflowPanel(workflow, true, false, { sent = it }, { fail("Shared phone cannot stop") }, false, QuestionDictation(1, "shared", "design", "A peaceful garden theme"), {}) } } } }
            await("Voice answer not in editable draft") { nodes().any { it.isEditable && it.text?.toString() == "A peaceful garden theme" } }
            assertNull(sent); assertTrue(nodes().none { it.text?.toString() == "Stop project workflow" }); screenshot("shared-project-question.png")
            click("Send answers to manager"); assertEquals("A peaceful garden theme", sent?.getJSONArray("answers")?.getJSONObject(0)?.optString("answer"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun intakeAnswersUseCurrentRevisionAndNeedExplicitPlanningStart() {
        val activity = activity(); val calls = mutableListOf<Pair<String, JSONObject?>>(); val state = mutableStateOf(JSONObject("""{"projectIntakes":[{"id":"intake","message":"Create a garden website","status":"awaiting_answers","revision":7,"questions":[{"id":"audience","question":"Who is it for?","answer":""}]}]}"""))
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.safeDrawingPadding()) { ProjectIntakesPanel(state.value, true, { _, path, body -> calls += path to body; JSONObject() }, {}, "intake", QuestionDictation(1, "intake", "audience", "Local garden volunteers"), { _, _ -> }, { _, _ -> }) } } } }
            await("Setup dictation absent") { nodes().any { it.isEditable && it.text?.toString() == "Local garden volunteers" } }; assertTrue(calls.isEmpty())
            click("Save setup answers"); await("No saved setup answers") { calls.size == 1 }; assertEquals(7, calls.single().second?.optInt("revision")); assertTrue(calls.none { it.first.endsWith("/start") })
            instrumentation.runOnMainSync { state.value = JSONObject("""{"projectIntakes":[{"id":"intake","projectId":"garden","message":"Create a garden website","status":"ready","revision":8,"questions":[]}]}""") }
            click("Start managed planning"); await("No planning request") { calls.size == 2 }; assertEquals("garden", calls.last().second?.optString("projectId")); assertEquals(8, calls.last().second?.optInt("revision"))
            instrumentation.runOnMainSync { state.value = JSONObject("""{"projectDeliveries":[{"id":"intake","projectId":"garden","summary":"Delivery needs an answer","status":"awaiting_answers","questions":[{"id":"audience","question":"Which public audience?","answer":""}]}]}""") }
            click("Save setup answers"); await("No saved delivery answer") { calls.any { it.first == "/api/project-deliveries/intake/answers" } }
            assertFalse(calls.last().second!!.has("revision")); assertTrue(nodes().none { it.text?.toString() == "Cancel setup" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun targetedCredentialHandoffClearsSecretsAndNeverUsesChat() {
        val activity = activity(); val allowed = mutableStateOf(true); val calls = mutableListOf<Pair<String, JSONObject?>>()
        val entry = JSONObject("""{"id":"handoff","provider":"vercel","accountLabel":"Garden owner","status":"waiting","deviceId":"phone","loginUrl":"https://vercel.com/account/tokens","expiresAt":"Synthetic expiry"}""")
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) { ConnectionHandoffPanel("phone", allowed.value, "handoff", { _, path, body -> calls += path to body; if (path.endsWith("/complete")) entry.put("status", "saved"); JSONObject().put("requests", JSONArray().put(entry)) }, {}) } } } }
            await("Secure handoff absent") { nodes().any { it.isEditable && it.isPassword } }; assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            text(1, "synthetic-token-only"); click("Save account on my PC")
            await("No handoff receipt") { nodes().any { it.text?.toString()?.contains("Account saved on your PC") == true } }
            assertEquals("synthetic-token-only", calls.last { it.first.endsWith("/complete") }.second?.optString("token")); assertTrue(calls.none { it.first.contains("/chat") })
            assertTrue(nodes().none { it.isEditable && it.isPassword }); instrumentation.runOnMainSync { allowed.value = false }
            await("Revoked handoff still visible") { nodes().none { it.text?.toString()?.contains("Garden owner") == true } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun lateBrowserCaptureCannotReturnAfterAccessIsRevoked() {
        val activity = activity(); val allowed = mutableStateOf(true); val result = CompletableDeferred<JSONObject>(); var waiting = false
        try {
            instrumentation.runOnMainSync { activity.setContent { MaterialTheme { Box(Modifier.fillMaxSize().safeDrawingPadding()) { BrowserStudioPanel("phone", allowed.value, emptyList(), "fixture") { _, path, _ ->
                if (path.endsWith("/frame")) { waiting = true; result.await() }
                else JSONObject("""{"available":true,"permitted":true,"sessions":[{"id":"fixture","mode":"project","status":"ready","activeTabId":"tab","tabs":[{"id":"tab","title":"Late fixture"}]}]}""")
            } } } } }
            await("No capture requested") { waiting }
            val frame = JSONObject().put("image", picture()).put("frameId", "late").put("expiresAt", Instant.now().plusSeconds(3))
            instrumentation.runOnMainSync { allowed.value = false; result.complete(frame) }
            await("Privacy explanation absent") { nodes().any { it.text?.toString()?.contains("enable Google, project and browser control") == true } }
            assertTrue(nodes().none { it.contentDescription?.toString() == "Current host browser frame" })
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
