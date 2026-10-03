package dev.nakama.companion

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

@RunWith(AndroidJUnit4::class)
class HostAlarmSoundsTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun clip(): ByteArray {
        val bytes = ByteArray(44 + 44_100); ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).put("RIFF".toByteArray()).putInt(bytes.size - 8).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(22_050).putInt(44_100).putShort(2).putShort(16).put("data".toByteArray()).putInt(44_100)
        return bytes
    }
    private fun manifest(id: String, bytes: ByteArray) = JSONObject().put("id", id).put("name", "Synthetic silent clip").put("sha256", AlarmSoundPolicy.sha256(bytes)).put("byteLength", bytes.size).put("durationMs", 1000).put("mimeType", "audio/wav")
    private fun snapshot(id: String, row: JSONObject) = JSONObject().put("alarmSounds", JSONArray().put(row)).put("routineBoard", JSONObject().put("routines", JSONArray().put(JSONObject().put("kind", "alarm").put("enabled", true).put("soundId", id).put("targetDeviceIds", JSONArray().put("sound-phone")))))
    @Test fun verifiedCustomClipPlaysOfflineAndExactStopSilencesOnlyRingingAlarms() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        check(android.os.Build.HARDWARE == "ranchu" && android.os.Build.FINGERPRINT.startsWith("Android/sdk_"))
        val vault = PairingVault(context); check(vault.load() == null)
        val preferences = context.getSharedPreferences("nakama_phone_alarms", Context.MODE_PRIVATE); check(preferences.all.isEmpty())
        val wake = context.getSharedPreferences("nakama_preferences", Context.MODE_PRIVATE); check(!wake.getBoolean("wakeEnabled", false))
        val bytes = clip(); val id = "playback-fixture-${System.nanoTime()}"; val row = manifest(id, bytes)
        val identity = HostIdentity("https://127.0.0.1:43110", "a".repeat(64), "synthetic-playback-token", "sound-phone", "Synthetic")
        var activity: MainActivity? = null; var stored: java.io.File? = null
        var activeResult: ((String) -> Unit)? = null
        fun main(block: () -> Unit) = instrumentation.runOnMainSync(block)
        fun await(message: String, predicate: () -> Boolean) {
            val end = android.os.SystemClock.elapsedRealtime() + 10_000
            while (android.os.SystemClock.elapsedRealtime() < end) { var ok = false; main { ok = predicate() }; if (ok) return; android.os.SystemClock.sleep(50) }
            fail(message)
        }
        try {
            listOf(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.POST_NOTIFICATIONS).forEach { instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it) }
            instrumentation.uiAutomation.executeShellCommand("appops set ${context.packageName} SCHEDULE_EXACT_ALARM allow").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            activity = instrumentation.startActivitySync(android.content.Intent(context, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            main {
                WakeWordService.recognitionFactoryForTest = { result, _ -> object : VoiceRecognition {
                    override val continuousSession = true
                    private var ready: () -> Unit = {}
                    override fun observe(onReady: () -> Unit, onEnd: () -> Unit, onPartial: (String) -> Unit) { ready = onReady }
                    override fun start() { activeResult = result; ready() }
                    override fun close() { if (activeResult === result) activeResult = null }
                } }
                wake.edit().putBoolean("wakeEnabled", true).commit()
                androidx.core.content.ContextCompat.startForegroundService(activity!!, android.content.Intent(context, WakeWordService::class.java))
            }
            await("Synthetic wake was not ready") { WakeWordService.running && activeResult != null }
            vault.save(identity)
            HostAlarmSounds.sync(context, identity, snapshot(id, row), { true }) { JSONObject(row.toString()).put("base64", Base64.getEncoder().encodeToString(bytes)) }
            stored = HostAlarmSounds.file(context, identity, id)
            val alarm = snapshot(id, row).getJSONObject("routineBoard").getJSONArray("routines").getJSONObject(0).put("id", "clip-alarm").put("updatedAt", "fixture-v1").put("title", "Synthetic silent alarm").put("time", "12:00").put("timeZone", "UTC").put("scheduledDate", java.time.LocalDate.now(java.time.ZoneOffset.UTC).plusDays(1).toString())
            main { PhoneAlarmScheduler.enable(context, identity.deviceId); assertEquals("scheduled", PhoneAlarmScheduler.sync(context, identity.deviceId, listOf(alarm)).single().getString("status")); PhoneAlarmScheduler.fire(context, "clip-alarm", "fixture-v1") }
            await("Verified private clip did not enter native playback") { AlarmPlaybackService.playing && AlarmAudioState.ringing(context) }
            await("Stop listener did not become ready during alarm") { WakeWordService.status.contains("say Nakama stop") && activeResult != null }
            main { activeResult!!.invoke("Nakama stop") }
            await("Exact Stop did not silence native playback and alarm notifications") { !AlarmPlaybackService.playing && !AlarmAudioState.ringing(context) }
            assertTrue("Stop must preserve future routine definitions", JSONObject(preferences.getString("routines", "{}").orEmpty()).has("clip-alarm"))
        } finally {
            main { PhoneAlarmScheduler.clear(context); wake.edit().putBoolean("wakeEnabled", false).commit(); context.stopService(android.content.Intent(context, WakeWordService::class.java)); activity?.finish() }
            await("Synthetic service did not stop") { !WakeWordService.running }
            main { WakeWordService.recognitionFactoryForTest = null }
            stored?.let { it.delete(); java.io.File(it.parentFile, it.nameWithoutExtension + ".json").delete() }
            vault.clear(); bytes.fill(0)
        }
        Unit
    }

    @Test fun explicitJsonNullRetainsDefaultAlarmSound() { assertEquals("", JSONObject().put("soundId", JSONObject.NULL).alarmSoundId()); assertEquals("", JSONObject().alarmSoundId()); assertEquals("clip-id", JSONObject().put("soundId", "clip-id").alarmSoundId()) }
    @Test fun downloadsOnlyAssignedManifestAndRejectsDigestOrPairingChanges() = runBlocking {
        val vault = PairingVault(context); val previous = vault.load(); val bytes = clip()
        val identity = HostIdentity("https://127.0.0.1:43110", "a".repeat(64), "synthetic-sound-token", "sound-phone", "Synthetic")
        val id = "sound-fixture-${System.nanoTime()}"; val row = manifest(id, bytes); val calls = mutableListOf<String>()
        try {
            vault.save(identity)
            HostAlarmSounds.sync(context, identity, snapshot(id, row), { true }) { path -> calls += path; JSONObject(row.toString()).put("base64", Base64.getEncoder().encodeToString(bytes)) }
            assertEquals(listOf("/api/alarm-sounds/$id/audio"), calls)
            val file = HostAlarmSounds.file(context, identity, id); assertNotNull(file)
            assertNull(HostAlarmSounds.file(context, identity.copy(deviceId = "other-phone"), id))
            val foreign = snapshot("foreign", manifest("foreign", bytes)); foreign.getJSONObject("routineBoard").getJSONArray("routines").getJSONObject(0).put("targetDeviceIds", JSONArray().put("other-phone"))
            HostAlarmSounds.sync(context, identity, foreign, { true }) { error("Must never download another device's sound") }
            val invalid = "invalid-${System.nanoTime()}"; val invalidRow = manifest(invalid, bytes)
            var rejected = false
            try { HostAlarmSounds.sync(context, identity, snapshot(invalid, invalidRow), { true }) { JSONObject(invalidRow.toString()).put("base64", Base64.getEncoder().encodeToString(bytes.copyOf().also { it[100] = 1 })) } } catch (_: IllegalArgumentException) { rejected = true }
            assertTrue(rejected); assertNull(HostAlarmSounds.file(context, identity, invalid))
            val revoked = "revoked-${System.nanoTime()}"; val revokedRow = manifest(revoked, bytes)
            rejected = false
            try { HostAlarmSounds.sync(context, identity, snapshot(revoked, revokedRow), { true }) { vault.clear(); JSONObject(revokedRow.toString()).put("base64", Base64.getEncoder().encodeToString(bytes)) } } catch (_: IllegalStateException) { rejected = true }
            assertTrue(rejected); assertNull(HostAlarmSounds.file(context, identity, revoked))
            file!!.delete(); java.io.File(file.parentFile, file.nameWithoutExtension + ".json").delete()
        } finally { bytes.fill(0); if (previous == null) vault.clear() else vault.save(previous) }
        Unit
    }
}
