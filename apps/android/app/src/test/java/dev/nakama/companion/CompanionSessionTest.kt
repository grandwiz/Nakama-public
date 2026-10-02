package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class CompanionSessionTest {
    @Test fun voiceLaunchIsForegroundOnlyAndConsumedOnce() {
        val gate = VoiceLaunchGate()
        assertFalse(gate.take(true))
        gate.request()
        assertFalse(gate.take(false))
        assertTrue(gate.take(true))
        assertFalse(gate.take(true))
        gate.request(); gate.pause()
        assertFalse("Returning after backgrounding must not reopen the microphone", gate.take(true))
    }

    @Test fun microphoneGrantCompletesOnlyTheCurrentExplicitRequest() {
        val gate = VoiceLaunchGate()
        gate.request(); assertTrue(gate.take(true)); gate.awaitingPermission(); gate.pause()
        assertFalse(gate.take(true))
        gate.permissionResult(true)
        assertFalse(gate.take(false)); assertTrue(gate.take(true)); assertFalse(gate.take(true))
        gate.permissionResult(true)
        assertFalse("Unsolicited permission callbacks must not open the microphone", gate.take(true))
        gate.request(); assertTrue(gate.take(true)); gate.awaitingPermission(); gate.cancel(); gate.permissionResult(true)
        assertFalse("Stop invalidates a late grant", gate.take(true))
        gate.request(); assertTrue(gate.take(true)); gate.awaitingPermission(); gate.permissionResult(false)
        assertFalse(gate.take(true))
    }

    @Test fun usageResponsesCannotCrossPrivacyConnectionOrPairingChanges() {
        val owner = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
        val original = UsageScope(owner, true, true)
        for (changed in listOf(original.copy(allowed = false), original.copy(connected = false), original.copy(identity = null), original.copy(identity = owner.copy(token = "new-fixture")))) {
            val gate = UsageRequestGate(); gate.update(original)
            val stale = requireNotNull(gate.begin())
            assertNull(gate.begin())
            gate.update(changed); assertFalse(gate.accepts(stale)); assertFalse(gate.finish(stale))
            gate.update(original)
            val fresh = requireNotNull(gate.begin())
            assertFalse(gate.accepts(stale)); assertTrue(gate.finish(fresh)); assertFalse(gate.finish(fresh))
        }
    }

    @Test fun usageRequiresAuthorisedConnectionAndDisposalInvalidatesResponse() {
        val gate = UsageRequestGate()
        gate.update(UsageScope(null, true, true)); assertNull(gate.begin())
        val owner = HostIdentity("https://fixture.invalid:43110", "a".repeat(64), "fixture", "phone", "Fixture")
        gate.update(UsageScope(owner, false, true)); assertNull(gate.begin())
        gate.update(UsageScope(owner, true, false)); assertNull(gate.begin())
        gate.update(UsageScope(owner, true, true)); val pending = requireNotNull(gate.begin())
        gate.invalidate(); assertFalse(gate.accepts(pending))
    }
}
