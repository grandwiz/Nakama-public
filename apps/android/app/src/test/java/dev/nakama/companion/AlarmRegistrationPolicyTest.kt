package dev.nakama.companion

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class AlarmRegistrationPolicyTest {
    @Test fun dueOneShotKeepsItsExistingAndroidRegistrationDuringAnUnrelatedRefresh() {
        val at = Instant.parse("2026-10-03T06:00:00Z")
        assertNull(FoundationPolicy.nextAlarm("07:00", emptySet(), "Europe/London", at, "2026-10-03"))
        assertTrue(AlarmRegistrationPolicy.preserve("v2", "v2", "v2", "scheduled", true, true, false))
    }
    @Test fun editsDisablingLostPermissionsAndConsumedOneShotsCannotKeepTheOldRegistration() {
        assertFalse(AlarmRegistrationPolicy.preserve("v3", "v2", "v2", "scheduled", true, true, false))
        assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", "v2", "scheduled", false, true, false))
        assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", "v2", "scheduled", true, false, false))
        assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", "v2", "scheduled", true, true, true))
    }
    @Test fun failedMissingOrStaleReceiptsNeedANewSchedulingAttempt() {
        for (status in listOf(null, "permission_required", "failed", "cancelled")) assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", "v2", status, true, true, false))
        assertFalse(AlarmRegistrationPolicy.preserve("v2", "v2", "v1", "scheduled", true, true, false))
        assertFalse(AlarmRegistrationPolicy.preserve("v2", null, "v2", "scheduled", true, true, false))
    }
}
