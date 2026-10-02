package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class PhoneControlSessionTest {
    @Test fun requiresFreshConsentForExactlyOneAppAndExpiresAtBoundary() {
        var clock = 500L
        val session = PhoneControlSession { clock }
        assertNull(session.token)
        val token = session.start("com.example.notes")
        assertEquals(120, session.remainingSeconds)
        assertTrue(session.allows(token, "com.example.notes"))
        assertFalse(session.allows(token, "com.example.mail"))
        assertFalse(session.allows(null, "com.example.notes"))
        clock += 119_999
        assertTrue(session.allows(token, "com.example.notes"))
        assertEquals(1, session.remainingSeconds)
        clock++
        assertNull(session.token)
        assertFalse(session.allows(token, "com.example.notes"))
        assertEquals(0, session.remainingSeconds)
    }

    @Test fun stopThenRestartCannotReviveAnInflightRequestEvenForTheSameApp() {
        val session = PhoneControlSession { 100L }
        val old = session.start("com.example.notes")
        session.stop()
        assertNull(session.token)
        assertEquals("", session.packageName)
        val fresh = session.start("com.example.notes")
        assertNotEquals(old, fresh)
        assertFalse(session.allows(old, "com.example.notes"))
        assertTrue(session.allows(fresh, "com.example.notes"))
    }

    @Test fun replacingTheAppInvalidatesAllEarlierRequests() {
        val session = PhoneControlSession { 0L }
        val first = session.start("com.example.notes")
        val second = session.start("com.example.mail")
        assertFalse(session.allows(first, "com.example.notes"))
        assertFalse(session.allows(first, "com.example.mail"))
        assertTrue(session.allows(second, "com.example.mail"))
    }
}
