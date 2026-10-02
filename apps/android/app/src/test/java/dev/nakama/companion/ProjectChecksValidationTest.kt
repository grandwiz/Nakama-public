package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class ProjectChecksValidationTest {
    @Test fun onlyExactListedCheckNamesAreAccepted() {
        listOf("test", "lint", "typecheck", "check", "build").forEach {
            assertTrue(it, ProjectChecksModels.isKnownCheck(it))
        }
        listOf("deploy", "dev", "install", "pretest", "TEST", " test", "test ", "test --watch", "test;deploy", "").forEach {
            assertFalse(it, ProjectChecksModels.isKnownCheck(it))
        }
    }

    @Test fun manifestMustBeAnExactSha256Digest() {
        assertTrue(ProjectChecksModels.isValidManifestHash("a1".repeat(32)))
        listOf("", "a".repeat(63), "a".repeat(65), "g".repeat(64), "a".repeat(64) + "\n", " " + "a".repeat(64)).forEach {
            assertFalse(ProjectChecksModels.isValidManifestHash(it))
        }
    }
}
