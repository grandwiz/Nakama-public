package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class GoogleFormsTest {
    @Test fun emailRequiresOneExplicitRecipientAndOneLineSubject() {
        GoogleForms.email("person@example.com", "Hello", "My exact message")
        listOf("person@example.com,other@example.com", "Person <person@example.com>", "bad\r\nBcc:other@example.com", "").forEach { address -> assertThrows(IllegalArgumentException::class.java) { GoogleForms.email(address, "Hello", "Message") } }
        assertThrows(IllegalArgumentException::class.java) { GoogleForms.email("person@example.com", "Hello\nBcc:other@example.com", "Message") }
    }
    @Test fun eventRequiresExplicitTimezoneAndPositiveInstantDuration() {
        GoogleForms.event("Meeting", "2026-09-30T14:00:00+01:00", "2026-09-30T15:00:00+01:00")
        assertThrows(IllegalArgumentException::class.java) { GoogleForms.event("Meeting", "2026-09-30T14:00:00", "2026-09-30T15:00:00+01:00") }
        assertThrows(IllegalArgumentException::class.java) { GoogleForms.event("Meeting", "2026-09-30T14:00:00Z", "2026-09-30T15:00:00+02:00") }
    }
}
