package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class ProjectAttentionPolicyTest {
    @Test fun autonomousQuestionAttentionDoesNotOfferVoiceSubmission() {
        assertFalse(AttentionPolicy.supportsVoiceAnswer(AttentionNotice("auto:one:q", "question", autonomousRunId = "one", questionId = "q")))
        assertTrue(AttentionPolicy.supportsVoiceAnswer(AttentionNotice("workflow:one:q", "question", workflowId = "one", questionId = "q")))
        assertFalse(AttentionPolicy.supportsVoiceAnswer(AttentionNotice("approval:one", "approval")))
    }
    @Test fun exportReceiptCannotSaveAnotherDocumentOrLaterPickerRequest() {
        val original = ProjectFilePolicy.text("notes.md", "Original content")
        val receipt = DocumentExportReceipt(original.name, original.mime, original.hash, 1)
        assertTrue(receipt.matches(original, 1)); assertFalse(receipt.matches(original, 2))
        assertFalse(receipt.matches(ProjectFilePolicy.text("notes.md", "Replacement content"), 1))
        assertFalse(receipt.matches(original.copy(name = "different.md"), 1))
        assertFalse(receipt.matches(original.copy(mime = "application/pdf"), 1))
    }
    @Test fun noticesDeduplicateAcrossPollsWithOnlyHashedIds() {
        val notices = listOf(AttentionNotice("q:one", "question"), AttentionNotice("q:one", "question"), AttentionNotice("b:two", "login"), AttentionNotice("unsupported", "secret"))
        assertEquals(2, AttentionPolicy.unread(notices, emptySet()).size)
        val persisted = AttentionPolicy.persisted(emptySet(), listOf("q:one"))
        assertFalse(persisted.contains("q:one")); assertEquals(listOf("b:two"), AttentionPolicy.unread(notices, persisted).map { it.id })
    }
    @Test fun dedupIsPairingScopedAndBounded() {
        val one = HostIdentity("https://pc.invalid", "a".repeat(64), "token-one", "phone", "A")
        assertEquals(AttentionPolicy.scope(one), AttentionPolicy.scope(one.copy(token = "rotated")))
        assertNotEquals(AttentionPolicy.scope(one), AttentionPolicy.scope(one.copy(deviceId = "other")))
        assertNotEquals(AttentionPolicy.scope(one), AttentionPolicy.scope(one.copy(fingerprint = "b".repeat(64))))
        val stored = AttentionPolicy.persisted(emptySet(), (1..600).map { "question-$it" })
        assertEquals(500, stored.size); assertFalse(AttentionPolicy.key("question-1") in stored); assertTrue(AttentionPolicy.key("question-600") in stored)
        assertEquals(10, AttentionPolicy.unread((1..30).map { AttentionNotice("q$it", "question") }, emptySet()).size)
    }
    @Test fun projectPathsAndDownloadsRejectTraversalAndEncodeQueries() {
        assertTrue(ProjectFilePolicy.relative("docs/my report.pdf")); assertTrue(ProjectFilePolicy.relative(""))
        listOf("../secret", "docs/../secret", "/tmp/key", "docs\\key", "x\u0000y").forEach { assertFalse(it, ProjectFilePolicy.relative(it)) }
        assertEquals("docs%2Fmy+report%2Epdf", ProjectFilePolicy.query("docs/my report.pdf"))
        assertEquals("report.pdf", ProjectFilePolicy.name("../report.pdf"))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ProjectFilePolicy.hash("abc".toByteArray()))
    }
    @Test fun browserAndPageNavigationRemainAllowlisted() {
        assertTrue(BrowserInputPolicy.id("browser_123-abc")); assertFalse(BrowserInputPolicy.id("../secrets"))
        assertTrue(BrowserInputPolicy.publicUrl("https://example.com/login"))
        listOf("http://example.com", "javascript:alert(1)", "https://token@example.com", "file:///tmp/test").forEach { assertFalse(BrowserInputPolicy.publicUrl(it)) }
        assertEquals(NakamaNavigation.Page("Tools", "Browser"), NavigationPolicy.parse("Nakama, open browser studio"))
        assertEquals(NakamaNavigation.Page("Tools", "Project setup"), NavigationPolicy.parse("open project setup"))
        assertEquals(NakamaNavigation.Page("Tools", "Account setup"), NavigationPolicy.parse("open account setup"))
        assertNull(NavigationPolicy.parse("They said open browser studio later"))
    }
}
