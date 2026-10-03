package dev.nakama.companion

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class OneShotAlarmPolicyTest {
    @Test fun datedAlarmUsesItsOwnTimezoneAndIgnoresRecurringWeekdays() {
        val now = Instant.parse("2026-10-02T18:00:00Z")
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), FoundationPolicy.nextAlarm("07:00", emptySet(), "Europe/London", now, "2026-10-03"))
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), FoundationPolicy.nextAlarm("07:00", setOf(1), "Europe/London", now, "2026-10-03"))
        assertEquals(Instant.parse("2026-10-02T22:30:00Z"), FoundationPolicy.nextAlarm("07:30", emptySet(), "Asia/Tokyo", now, "2026-10-03"))
    }
    @Test fun oneTimeAlarmNeverBecomesTomorrowOrNextWeekAfterItsTime() {
        val at = Instant.parse("2026-10-03T06:00:00Z")
        assertNull(FoundationPolicy.nextAlarm("07:00", (0..6).toSet(), "Europe/London", at, "2026-10-03"))
        assertNull(FoundationPolicy.nextAlarm("07:00", (0..6).toSet(), "Europe/London", at.plusSeconds(86400), "2026-10-03"))
    }
    @Test fun invalidDatesAndDaylightSavingGapCannotBecomeRecurringAlarms() {
        val now = Instant.parse("2026-01-01T00:00:00Z")
        for (date in listOf("", "2026-02-30", "2026-1-2", "2026-13-01", "tomorrow")) assertNull(date, FoundationPolicy.nextAlarm("07:00", (0..6).toSet(), "Europe/London", now, date))
        assertNull(FoundationPolicy.nextAlarm("01:30", (0..6).toSet(), "Europe/London", now, "2026-03-29"))
        assertEquals(Instant.parse("2026-10-25T00:30:00Z"), FoundationPolicy.nextAlarm("01:30", emptySet(), "Europe/London", now, "2026-10-25"))
        assertNull(FoundationPolicy.nextAlarm("01:30", emptySet(), "Europe/London", Instant.parse("2026-10-25T00:40:00Z"), "2026-10-25"))
    }
}
