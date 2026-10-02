package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class MotionAndDraftPolicyTest {
    @Test fun disabledOrInvalidSystemMotionNeverAnimates() {
        assertTrue(MotionPolicy.enabled(false, 1f))
        assertFalse(MotionPolicy.enabled(true, 1f))
        assertFalse(MotionPolicy.enabled(false, 1f, false))
        for (scale in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) assertFalse(MotionPolicy.enabled(false, scale))
        assertEquals(0, MotionPolicy.duration(false, 220))
        assertEquals(600, MotionPolicy.duration(true, 6000))
        assertEquals(500.0, MotionPolicy.clock(1000, 2f), 0.01)
        assertTrue(MotionPolicy.clock(1000, Float.NaN).isFinite())
    }
    @Test fun skillBoundsMatchHostAndDoNotSilentlyDropExtraSteps() {
        assertTrue(SkillDraftPolicy.valid("Test", "A method", "When testing", "One\nTwo", "android, tests,android"))
        assertEquals(listOf("android", "tests"), SkillDraftPolicy.tags("android, tests,android"))
        assertFalse(SkillDraftPolicy.valid("", "Method", "When", "One", ""))
        assertFalse(SkillDraftPolicy.valid("Test", "Method", "When", (1..13).joinToString("\n") { "Step $it" }, ""))
        assertFalse(SkillDraftPolicy.valid("Test", "Method", "When", "X".repeat(501), ""))
        assertFalse(SkillDraftPolicy.valid("Test", "Method", "When", "One", (1..9).joinToString(",") { "tag$it" }))
    }
    @Test fun gitImportIsExplicitGithubHttpsAndAuthorCannotInjectHeaders() {
        assertTrue(GithubDraftPolicy.repository("owner/repo"))
        assertTrue(GithubDraftPolicy.repository("https://github.com/owner/repo.git"))
        for (value in listOf("git@github.com:owner/repo", "https://other.example/owner/repo", "https://token@github.com/owner/repo", "../repo", "owner/repo;rm", "owner/repo?token=secret")) assertFalse(value, GithubDraftPolicy.repository(value))
        assertTrue(GithubDraftPolicy.author("Fixture User", "fixture@example.invalid"))
        assertFalse(GithubDraftPolicy.author("Fixture\nInjected", "fixture@example.invalid"))
        assertFalse(GithubDraftPolicy.author("Fixture", "bad email"))
        assertTrue(GithubDraftPolicy.message("Update notes"))
        assertFalse(GithubDraftPolicy.message("Update\nnotes"))
        assertFalse(GithubDraftPolicy.message("x".repeat(501)))
    }
    @Test fun skillsAndGithubNavigateWithoutModelWorkButNeverExecuteOperations() {
        assertEquals(NakamaNavigation.Page("Tools", "Skills"), NavigationPolicy.parse("open learned skills"))
        assertEquals(NakamaNavigation.Page("Projects"), NavigationPolicy.parse("show github"))
        assertEquals(NakamaNavigation.Page("Tools", "Skills"), NavigationPolicy.hostTarget("skills"))
        assertNull(NavigationPolicy.parse("push my github project"))
        assertNull(NavigationPolicy.parse("open skills and approve all"))
    }
}
