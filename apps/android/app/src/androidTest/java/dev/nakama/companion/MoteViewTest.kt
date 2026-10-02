package dev.nakama.companion

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic canvas fixtures only: no service, microphone, model, pairing or app control. */
@RunWith(AndroidJUnit4::class)
class MoteViewTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun emulatorOnly() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable Android emulator only." }
    }
    private fun render(view: MoteView): Bitmap {
        view.layout(0, 0, 100, 120)
        return Bitmap.createBitmap(100, 120, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    }
    @Test fun computerAndWaitIndicatorRenderAndExportSyntheticPreview() {
        emulatorOnly()
        instrumentation.runOnMainSync {
            val states = listOf(MoteWorkState.IDLE, MoteWorkState.WORKING, MoteWorkState.WAITING)
            val images = states.map { state ->
                val view = MoteView(instrumentation.context, showWorkStatus = true).apply { animate = false; workState = state }
                assertTrue(view.contentDescription.toString().contains(state.description))
                assertTrue(view.contentDescription.toString().contains("Hold to hide Mote"))
                assertEquals(state.description, view.stateDescription)
                render(view)
            }
            assertNotEquals(images[0].getPixel(25, 65), images[1].getPixel(25, 65))
            assertNotEquals(images[1].getPixel(50, 73), images[2].getPixel(50, 73))
            val preview = Bitmap.createBitmap(960, 400, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(preview)
            canvas.drawColor(Color.rgb(240, 244, 250))
            images.forEachIndexed { index, bitmap ->
                canvas.save(); canvas.translate(index * 320f + 10f, 20f); canvas.scale(3f, 3f)
                canvas.drawBitmap(bitmap, 0f, 0f, null); canvas.restore()
            }
            File(instrumentation.targetContext.cacheDir, "mote-synthetic-preview.png").outputStream().use {
                assertTrue(preview.compress(Bitmap.CompressFormat.PNG, 100, it))
            }
        }
    }
    @Test fun reducedMotionKeepsWorkingViewStillWithoutLosingStatus() {
        emulatorOnly()
        // Test-package preferences never alter the installed app's preferences.
        val preferences = instrumentation.context.getSharedPreferences("nakama_preferences", android.content.Context.MODE_PRIVATE)
        val previous = preferences.getBoolean("reduceMotion", false)
        preferences.edit().putBoolean("reduceMotion", true).commit()
        try {
            lateinit var view: MoteView
            lateinit var first: Bitmap
            instrumentation.runOnMainSync {
                view = MoteView(instrumentation.context, showWorkStatus = true).apply { workState = MoteWorkState.WORKING }
                first = render(view)
            }
            SystemClock.sleep(300)
            instrumentation.runOnMainSync {
                assertTrue(first.sameAs(render(view)))
                assertEquals(MoteWorkState.WORKING.description, view.stateDescription)
                view.workState = MoteWorkState.SPEAKING
                assertEquals(MoteWorkState.SPEAKING.description, view.stateDescription)
            }
        } finally { preferences.edit().putBoolean("reduceMotion", previous).commit() }
    }
    @Test fun staleSnapshotCannotEarnAttentionSideEffectsAfterRevocation() {
        emulatorOnly()
        val identity = HostIdentity("https://fixture.invalid:43110", "0".repeat(64), "synthetic-only", "fixture-phone", "Fixture")
        val snapshot = JSONObject("""{"devices":[{"id":"fixture-phone","permissions":{"googleAccess":true,"projectAccess":true}}],"tasks":[{"status":"running"}]}""")
        MoteWorkSignals.clearHost()
        val oldRequest = SystemClock.elapsedRealtime()
        assertTrue(MoteWorkSignals.updateHost(identity, snapshot, oldRequest))
        SystemClock.sleep(2)
        val revoked = JSONObject(snapshot.toString())
        revoked.getJSONArray("devices").getJSONObject(0).getJSONObject("permissions").put("googleAccess", false)
        assertTrue(MoteWorkSignals.updateHost(identity, revoked))
        // The service performs attention side effects only when updateHost accepts the snapshot.
        assertFalse(MoteWorkSignals.updateHost(identity, snapshot, oldRequest))
        assertFalse(MoteWorkSignals.clearHost(identity, oldRequest))
        assertEquals(MoteWorkState.IDLE, MoteWorkSignals.current(identity))
        MoteWorkSignals.clearHost()
    }
    @Test fun privateBrowserAndRevokedPermissionsCannotSignalComputerWork() {
        emulatorOnly()
        val identity = HostIdentity("https://fixture.invalid:43110", "0".repeat(64), "synthetic-only", "fixture-phone", "Fixture")
        val snapshot = JSONObject("""{"devices":[{"id":"fixture-phone","permissions":{"googleAccess":true,"projectAccess":true}}],"browserStudio":{"sessions":[{"status":"running","mode":"private","tainted":true,"title":"Never copy me"}]}}""")
        MoteWorkSignals.clearHost()
        MoteWorkSignals.updateHost(identity, snapshot)
        assertEquals(MoteWorkState.IDLE, MoteWorkSignals.current(identity))
        snapshot.put("tasks", org.json.JSONArray().put(JSONObject().put("status", "running")))
        MoteWorkSignals.updateHost(identity, snapshot)
        assertEquals(MoteWorkState.WORKING, MoteWorkSignals.current(identity))
        snapshot.getJSONArray("devices").getJSONObject(0).getJSONObject("permissions").put("googleAccess", false)
        MoteWorkSignals.updateHost(identity, snapshot)
        assertEquals(MoteWorkState.IDLE, MoteWorkSignals.current(identity))
        MoteWorkSignals.clearHost(identity)
    }
}
