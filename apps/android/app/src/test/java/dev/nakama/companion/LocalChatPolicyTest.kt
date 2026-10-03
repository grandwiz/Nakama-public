package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class LocalChatPolicyTest {
    @Test fun rotatesAtSixHoursWithoutDiscardingPartialWindow() {
        val start = "2026-10-03T08:00:00Z"
        assertFalse(LocalChatPolicy.expired(start, Instant.parse("2026-10-03T13:59:59.999Z")))
        assertTrue(LocalChatPolicy.expired(start, Instant.parse("2026-10-03T14:00:00Z")))
        assertTrue(LocalChatPolicy.expired("invalid", Instant.parse(start)))
    }
    @Test fun largeOriginalsSplitLosslesslyWithoutSplittingUnicode() {
        val original = "x".repeat(7999) + "🌍".repeat(9000) + " last words"
        val parts = LocalChatPolicy.parts(original)
        assertEquals(original, parts.joinToString(""))
        assertTrue(parts.all { it.length <= LocalChatPolicy.PART_CHARS && !it.last().isHighSurrogate() && !it.first().isLowSurrogate() })
    }
    @Test fun deterministicSummaryCoversImportantMiddleTurnAndItsReply() {
        val messages = (0 until 30).flatMap { index -> listOf("user" to if (index == 14) "Important: the deadline is Friday" else "Routine question $index", "assistant" to if (index == 14) "Saved the Friday deadline" else "Routine reply $index") }
        val summary = LocalChatPolicy.extract(messages)
        assertEquals(summary, LocalChatPolicy.extract(messages))
        assertTrue(summary.contains("Important: the deadline is Friday"))
        assertTrue(summary.contains("Saved the Friday deadline"))
        assertTrue(summary.contains("Routine question 0"))
        assertTrue(summary.contains("Routine question 25"))
        assertTrue(summary.length <= 1400)
    }
}
