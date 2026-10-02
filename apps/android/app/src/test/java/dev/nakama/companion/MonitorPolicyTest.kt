package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class MonitorPolicyTest {
    @Test fun localMatchingRequiresPositiveEvidenceAndHonoursNegativeEvidence() {
        assertEquals("match", MonitorPolicy.evaluate("available", "out of stock", listOf("AVAILABLE", "One item"), false, false))
        assertEquals("no_match", MonitorPolicy.evaluate("available", "out of stock", listOf("Available", "Out of stock"), false, false))
        assertEquals("no_match", MonitorPolicy.evaluate("in stock", "", listOf("Loading"), false, false))
    }
    @Test fun sensitiveOrIncompleteScreensNeverMatch() {
        assertEquals("sensitive", MonitorPolicy.evaluate("in stock", "", listOf("In stock"), true, false))
        assertEquals("unavailable", MonitorPolicy.evaluate("in stock", "", listOf("In stock"), false, true))
        assertEquals("unavailable", MonitorPolicy.evaluate("", "", listOf("In stock"), false, false))
    }
    @Test fun exactPackagesCannotExpandToSystemSettingsOrHost() {
        assertTrue(MonitorPolicy.packageAllowed("com.example.reader"))
        listOf("android", "dev.nakama.companion", "com.android.settings", "com.google.android.permissioncontroller", "com.fake.systemui").forEach { assertFalse(it, MonitorPolicy.packageAllowed(it)) }
        assertFalse(MonitorPolicy.packageAllowed("com.example.*"))
    }
    @Test fun consentCannotSurviveChangesExpiryPauseOrAnotherPairing() {
        fun valid(scope: String? = "host1", expiry: Long = 100, time: Long = 99, pkg: String = "com.example.reader", condition: String = "in stock", status: String = "active") =
            MonitorPolicy.consentCurrent("host1", scope, expiry, time, "com.example.reader", pkg, "in stock", condition, status)
        assertTrue(valid())
        assertFalse(valid(scope = "host2")); assertFalse(valid(scope = null))
        assertFalse(valid(time = 100)); assertFalse(valid(pkg = "com.example.other"))
        assertFalse(valid(condition = "password")); assertFalse(valid(status = "paused")); assertFalse(valid(status = "attention"))
    }
    @Test fun newNavigationAndNoticesNeverOfferVoicePaymentOrConsent() {
        assertEquals(NakamaNavigation.Page("Tools", "Monitoring"), NavigationPolicy.parse("Nakama, open monitoring mode"))
        assertEquals(NakamaNavigation.Page("Tools", "Dynamic upgrade"), NavigationPolicy.parse("open dynamic upgrade"))
        assertEquals(NakamaNavigation.Page("Tools", "Dynamic upgrade"), NavigationPolicy.hostTarget("self-maintenance"))
        assertNull(NavigationPolicy.parse("open monitoring and buy the item"))
        assertFalse(AttentionPolicy.supportsVoiceAnswer(AttentionNotice("monitor:1", "monitor", monitorId = "1")))
        assertFalse(AttentionPolicy.supportsVoiceAnswer(AttentionNotice("upgrade:1", "upgrade", selfMaintenanceId = "1")))
        assertEquals(2, AttentionPolicy.unread(listOf(AttentionNotice("monitor:1", "monitor"), AttentionNotice("upgrade:1", "upgrade")), emptySet()).size)
    }
}
