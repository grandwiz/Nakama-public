package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class MoteWorkPolicyTest {
    @Test fun permissionsAndOpenSessionsDoNotImplyWork() {
        assertEquals(MoteWorkState.IDLE, MoteWorkPolicy.classify(emptyList(), true))
        assertEquals(MoteWorkState.IDLE, MoteWorkPolicy.classify(listOf(MoteWorkRecord("running")), false))
        assertEquals(MoteWorkState.IDLE, MoteWorkPolicy.classify(listOf(MoteWorkRecord("open"), MoteWorkRecord("active")), true))
    }
    @Test fun onlyRunningRecordsShowWorkAndUnknownStatusesStayStill() {
        assertEquals(MoteWorkState.WORKING, MoteWorkPolicy.classify(listOf(MoteWorkRecord("running", "thinking")), true))
        assertEquals(MoteWorkState.IDLE, MoteWorkPolicy.classify(listOf(MoteWorkRecord("invented")), true))
        for (status in listOf("completed", "failed", "stopped", "interrupted", "cancelled", "ready")) {
            assertEquals(status, MoteWorkState.IDLE, MoteWorkPolicy.classify(listOf(MoteWorkRecord(status)), true))
        }
    }
    @Test fun approvalAndQueueWaitsNeverAnimateTheComputer() {
        for (status in listOf("queued", "awaiting_answers", "awaiting_approval", "awaiting_result", "needs_attention", "held", "paused")) {
            assertEquals(status, MoteWorkState.WAITING, MoteWorkPolicy.classify(listOf(MoteWorkRecord(status)), true))
        }
        assertEquals(MoteWorkState.WAITING, MoteWorkPolicy.classify(listOf(MoteWorkRecord("running", "awaiting_check_approval")), true))
        assertEquals(MoteWorkState.IDLE, MoteWorkPolicy.classify(listOf(MoteWorkRecord("stopped", "awaiting_check_approval")), true))
    }
    @Test fun concurrentActualWorkCanContinueWhileAnotherTaskWaits() {
        assertEquals(MoteWorkState.WORKING, MoteWorkPolicy.classify(listOf(MoteWorkRecord("awaiting_approval"), MoteWorkRecord("running")), true))
    }
    @Test fun statusExpiresAndNeverCrossesPairings() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        assertEquals(MoteWorkState.IDLE, tracker.state(null))
        assertEquals(MoteWorkState.UNAVAILABLE, tracker.state("phone-a"))
        assertTrue(tracker.updateHost("phone-a", MoteWorkState.WORKING, clock))
        assertEquals(MoteWorkState.WORKING, tracker.state("phone-a"))
        assertEquals(MoteWorkState.UNAVAILABLE, tracker.state("phone-b"))
        clock += 20_001
        assertEquals(MoteWorkState.UNAVAILABLE, tracker.state("phone-a"))
    }
    @Test fun lateHostResponseCannotRestoreRevokedActivity() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        tracker.updateHost("phone-a", MoteWorkState.WORKING, clock)
        clock = 200
        tracker.clearHost("phone-a")
        assertFalse(tracker.updateHost("phone-a", MoteWorkState.WORKING, 150))
        assertEquals(MoteWorkState.UNAVAILABLE, tracker.state("phone-a"))
        assertTrue(tracker.updateHost("phone-a", MoteWorkState.IDLE, 200))
        assertEquals(MoteWorkState.IDLE, tracker.state("phone-a"))
    }
    @Test fun anOlderResponseOrFailureCannotOverwriteAnotherPairing() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        tracker.updateHost("phone-a", MoteWorkState.WORKING, clock)
        clock = 300
        tracker.updateHost("phone-b", MoteWorkState.WAITING, 280)
        tracker.clearHost("phone-a")
        assertEquals(MoteWorkState.WAITING, tracker.state("phone-b"))
        assertFalse(tracker.updateHost("phone-a", MoteWorkState.WORKING, 200))
        assertFalse(tracker.updateHost("phone-b", MoteWorkState.WORKING, 301))
    }
    @Test fun delayedFailureCannotClearNewerSamePairingStatus() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        tracker.updateHost("phone", MoteWorkState.WAITING, 100)
        clock = 300
        tracker.updateHost("phone", MoteWorkState.WORKING, 250)
        assertFalse(tracker.clearHost("phone", 200))
        assertEquals(MoteWorkState.WORKING, tracker.state("phone"))
        assertFalse(tracker.clearHost("phone", 301))
        assertEquals(MoteWorkState.WORKING, tracker.state("phone"))
        assertTrue(tracker.clearHost("phone", 300))
        assertEquals(MoteWorkState.UNAVAILABLE, tracker.state("phone"))
        assertFalse(tracker.updateHost("phone", MoteWorkState.WORKING, 250))
    }
    @Test fun freshForegroundUpdatesAvoidDuplicateBackgroundRequests() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        tracker.updateHost("phone-a", MoteWorkState.IDLE, clock)
        assertTrue(tracker.hasRecentHost("phone-a"))
        assertFalse(tracker.hasRecentHost("phone-b"))
        clock += 4001
        assertFalse(tracker.hasRecentHost("phone-a"))
    }
    @Test fun overlappingLocalActionsNeedTheirOwnCompletionAndExpire() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        val first = tracker.beginLocalWork()
        val second = tracker.beginLocalWork()
        tracker.endLocalWork(first)
        assertEquals(MoteWorkState.WORKING, tracker.state(null))
        tracker.endLocalWork(second)
        assertEquals(MoteWorkState.IDLE, tracker.state(null))
        tracker.beginLocalWork()
        clock += 120_001
        assertEquals(MoteWorkState.IDLE, tracker.state(null))
    }
    @Test fun voiceStatesAreDistinctFromWorkAndClearIndependently() {
        var clock = 100L
        val tracker = MoteWorkTracker { clock }
        val work = tracker.beginLocalWork()
        tracker.setVoiceState("foreground", MoteVoiceState.LISTENING)
        assertEquals(MoteWorkState.LISTENING, tracker.state(null))
        tracker.setVoiceState("wake", MoteVoiceState.SPEAKING)
        assertEquals(MoteWorkState.SPEAKING, tracker.state(null))
        tracker.setVoiceState("wake", MoteVoiceState.IDLE)
        assertEquals(MoteWorkState.LISTENING, tracker.state(null))
        tracker.setVoiceState("foreground", MoteVoiceState.IDLE)
        assertEquals(MoteWorkState.WORKING, tracker.state(null))
        tracker.endLocalWork(work)
        tracker.setVoiceState("wake", MoteVoiceState.SPEAKING)
        clock += 120_001
        assertEquals(MoteWorkState.IDLE, tracker.state(null))
    }
}
