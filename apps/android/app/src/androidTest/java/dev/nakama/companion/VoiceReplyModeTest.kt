package dev.nakama.companion

import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** All playback is fake; no microphone, model, host, or real phone action is used. */
@RunWith(AndroidJUnit4::class)
class VoiceReplyModeTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun field(name: String) = MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }
    private fun call(activity: MainActivity, name: String, vararg args: Any?) {
        val method = MainActivity::class.java.declaredMethods.single { it.name == name && it.parameterCount == args.size }
        method.isAccessible = true; method.invoke(activity, *args)
    }
    @Test fun localTypedRepliesStaySilentAndVoiceRepliesIgnoreTheLegacyGlobalMute() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        val context = instrumentation.targetContext
        PairingVault(context).clear()
        context.getSharedPreferences("nakama_preferences", 0).edit().putBoolean("spokenReplies", false).putBoolean("wakeEnabled", false).commit()
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try { instrumentation.runOnMainSync {
            (field("voice").get(activity) as VoiceController).close()
            val services = FakeVoiceServices()
            val controller = VoiceController(services, MemoryVoicePreferences(), {}, {})
            field("voice").set(activity, controller)
            call(activity, "editDraft", "open tasks", false); call(activity, "sendChat", ReplyMode.TEXT)
            assertTrue("Typing must not play a voice receipt", services.output.spoken.isEmpty())
            call(activity, "editDraft", "open routines", true); call(activity, "sendChat", ReplyMode.VOICE)
            assertEquals(1, services.output.spoken.size)
            assertTrue(services.output.spoken.single().first.contains("Routines"))
            call(activity, "editDraft", "open tasks", false); call(activity, "sendChat", ReplyMode.TEXT)
            assertEquals("Typed follow-up must remain silent", 1, services.output.spoken.size)
        } } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun delayedPlaybackOnlyConsumesVoiceEnrolledTaskIdsInTheCurrentSession() {
        check(Build.HARDWARE == "ranchu" && Build.FINGERPRINT.startsWith("Android/sdk_")) { "Disposable emulator only." }
        val context = instrumentation.targetContext
        PairingVault(context).clear()
        context.getSharedPreferences("nakama_preferences", 0).edit().putBoolean("wakeEnabled", false).commit()
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try { instrumentation.runOnMainSync {
            (field("voice").get(activity) as VoiceController).close()
            val services = FakeVoiceServices(); field("voice").set(activity, VoiceController(services, MemoryVoicePreferences(), {}, {}))
            val identity = HostIdentity("https://fixture.invalid", "a".repeat(64), "synthetic", "phone", "Fixture")
            val snapshot = JSONObject("""{"devices":[{"id":"phone","permissions":{"googleAccess":true,"projectAccess":true}}],"messages":[{"id":"typed","role":"assistant","taskId":"typed-task","content":"TYPED MUST STAY SILENT"},{"id":"voice","role":"assistant","taskId":"voice-task","content":"Your spoken answer"},{"id":"stale","role":"assistant","taskId":"old-task","content":"STALE MUST STAY SILENT"}]}""")
            call(activity, "setIdentity", identity); call(activity, "setStateIdentity", identity); call(activity, "setState", snapshot); call(activity, "setConnection", "Connected to Fixture")
            val session = field("replySession").getLong(activity)
            @Suppress("UNCHECKED_CAST") val tasks = field("pendingSpeechTasks").get(activity) as MutableMap<String, Long>
            tasks["voice-task"] = session; tasks["old-task"] = session - 1
            call(activity, "deliverPendingReplies", snapshot, session)
            assertEquals(listOf("Your spoken answer"), services.output.spoken.map { it.first })
            assertFalse(tasks.containsKey("voice-task"))
            // Remove the fixture identity before the Activity's polling coroutine can resume.
            call(activity, "setIdentity", null); call(activity, "setStateIdentity", null)
        } } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
