package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class ReplyPollingTest {
    @Test fun pcRestartAndAllTerminalOutcomesEndTheWait() {
        for (status in listOf("failed", "stopped", "cancelled", "interrupted")) {
            assertTrue(ReplyPolling.finished(status)); assertTrue(ReplyPolling.unsuccessful(status))
        }
        assertTrue(ReplyPolling.finished("completed")); assertFalse(ReplyPolling.unsuccessful("completed"))
        for (status in listOf("queued", "running", "")) assertFalse(ReplyPolling.finished(status))
        val pending = PendingReplies(); pending.add(listOf("restarted-task"), 1_000)
        if (ReplyPolling.finished("interrupted")) pending.resolve(setOf("restarted-task"))
        assertNull(pending.oldestStartedAt)
    }

    @Test fun responsivePollingIsBoundedAndBacksOffLongGenerations() {
        val start = 5_000L
        assertEquals(750L, ReplyPolling.delayMs(true, start, start))
        assertEquals(750L, ReplyPolling.delayMs(true, start, start + 29_999))
        assertEquals(1_500L, ReplyPolling.delayMs(true, start, start + 30_000))
        assertEquals(3_000L, ReplyPolling.delayMs(true, start, start + 120_000))
        assertEquals(4_500L, ReplyPolling.delayMs(true, start, start + 300_000))
        assertEquals(750L, ReplyPolling.delayMs(true, start, start - 1))
    }

    @Test fun backgroundOfflineUnpairedOrDisabledChatNeverPollsFast() {
        assertEquals(4_500L, ReplyPolling.delayMs(false, 0, 500))
        assertEquals(4_500L, ReplyPolling.delayMs(true, null, 500))
        assertEquals(4_500L, ReplyPolling.delayMs(false, null, 500))
    }

    @Test fun onlySubmittedRepliesCountAndPlannerCompletionStillWaitsForDevelopment() {
        val pending = PendingReplies()
        pending.resolve(setOf("someone-elses-task"))
        assertNull(pending.oldestStartedAt)
        pending.add(listOf("planner", "developer", ""), 1_000)
        pending.add(listOf("planner"), 10_000)
        assertEquals(1_000L, pending.oldestStartedAt)
        pending.resolve(setOf("planner", "someone-elses-task"))
        assertEquals(setOf("developer"), pending.ids)
        assertEquals(1_000L, pending.oldestStartedAt)
        pending.resolve(setOf("developer"))
        assertNull(pending.oldestStartedAt)
    }

    @Test fun stopPrivacyOrBackgroundClearsWaitingAndNewSessionStartsFresh() {
        val pending = PendingReplies()
        pending.add(listOf("old"), 1_000)
        pending.clear()
        assertTrue(pending.ids.isEmpty()); assertNull(pending.oldestStartedAt)
        pending.add(listOf("new"), 20_000)
        pending.resolve(setOf("old"))
        assertEquals(setOf("new"), pending.ids); assertEquals(20_000L, pending.oldestStartedAt)
    }
}
