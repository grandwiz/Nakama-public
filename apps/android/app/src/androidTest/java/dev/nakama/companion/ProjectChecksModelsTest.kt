package dev.nakama.companion

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProjectChecksModelsTest {
    private val hash = "a".repeat(64)
    private fun catalogueJson() = JSONObject().put("supported", true).put("manifestHash", hash)
        .put("runtime", JSONObject().put("available", true)).put("active", false)
        .put("checks", JSONArray().put(JSONObject().put("name", "test").put("script", "node fixture-test.cjs")
            .put("preScript", "node fixture-pre.cjs").put("postScript", "node fixture-post.cjs")))

    private fun task(id: String, project: String = "project-one", kind: String = "project_check", check: String = "test") =
        JSONObject().put("id", id).put("projectId", project).put("kind", kind).put("checkName", check)
            .put("status", "interrupted").put("title", "npm run $check").put("createdAt", "2026-09-29T04:00:00.000Z")

    private fun hasBrokenSurrogate(text: String): Boolean {
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (Character.isHighSurrogate(char)) {
                if (index + 1 >= text.length || !Character.isLowSurrogate(text[index + 1])) return true
                index += 2
            } else {
                if (Character.isLowSurrogate(char)) return true
                index++
            }
        }
        return false
    }

    @Test fun catalogueKeepsExactLifecycleAndRejectsUnlistedOrMalformedEntries() {
        val json = catalogueJson()
        json.getJSONArray("checks")
            .put(JSONObject().put("name", "deploy").put("script", "never run"))
            .put(JSONObject().put("name", "lint").put("script", 42))
            .put(JSONObject().put("name", "build").put("script", " "))
            .put(JSONObject().put("name", "test").put("script", "duplicate must not replace original"))
        val parsed = ProjectChecksModels.catalogue(json)
        assertTrue(parsed.supported)
        assertEquals(hash, parsed.manifestHash)
        assertEquals(1, parsed.checks.size)
        assertEquals("node fixture-test.cjs", parsed.checks.single().script)
        assertEquals("node fixture-pre.cjs", parsed.checks.single().preScript)
        assertEquals("node fixture-post.cjs", parsed.checks.single().postScript)
        assertFalse(parsed.checks.single().truncated)
        assertFalse(ProjectChecksModels.catalogue(catalogueJson().put("supported", "true")).supported)
        assertFalse(ProjectChecksModels.catalogue(catalogueJson().put("runtime", JSONObject().put("available", "true"))).runtimeAvailable)
        assertNull(ProjectChecksModels.catalogue(catalogueJson().put("manifestHash", "invalid")).manifestHash)
    }

    @Test fun requestsContainOnlyFreshManifestAndOneListedCheck() {
        val parsed = ProjectChecksModels.catalogue(catalogueJson())
        val request = ProjectChecksModels.requestBody(parsed, "test")
        assertEquals(setOf("name", "manifestHash"), request.keys().asSequence().toSet())
        assertEquals("test", request.getString("name"))
        assertEquals(hash, request.getString("manifestHash"))
        for (invalid in listOf(parsed.copy(supported = false), parsed.copy(runtimeAvailable = false), parsed.copy(active = true), parsed.copy(manifestHash = null))) {
            assertThrows(IllegalArgumentException::class.java) { ProjectChecksModels.requestBody(invalid, "test") }
        }
        for (name in listOf("lint", "deploy", "test --watch", "")) {
            assertThrows(IllegalArgumentException::class.java) { ProjectChecksModels.requestBody(parsed, name) }
        }
    }

    @Test fun historyUsesExactProjectKindAndRecordedNullableExitWithoutInferringSuccess() {
        val tasks = JSONArray()
            .put(task("missing").put("output", "All tests passed (untrusted log text)."))
            .put(task("null").put("exitCode", JSONObject.NULL))
            .put(task("string").put("exitCode", "0"))
            .put(task("fraction").put("exitCode", 1.5))
            .put(task("overflow").put("exitCode", Long.MAX_VALUE))
            .put(task("success").put("status", "completed").put("exitCode", 0))
            .put(task("failed").put("status", "failed").put("exitCode", 7).put("signal", "SIGTERM"))
            .put(task("wrong-project", project = "project-two"))
            .put(task("wrong-kind", kind = "command"))
            .put(task("unsupported", check = "deploy"))
        val state = JSONObject().put("tasks", tasks)
        val parsed = ProjectChecksModels.tasks(state, "project-one", true)
        assertEquals(7, parsed.size)
        for (id in listOf("missing", "null", "string", "fraction", "overflow")) {
            assertNull(id, parsed.single { it.id == id }.exitCode)
            assertEquals("interrupted", parsed.single { it.id == id }.status)
        }
        assertEquals(0, parsed.single { it.id == "success" }.exitCode)
        assertEquals(7, parsed.single { it.id == "failed" }.exitCode)
        assertEquals("SIGTERM", parsed.single { it.id == "failed" }.signal)
        assertTrue(ProjectChecksModels.tasks(state, "project-one", false).isEmpty())
        assertTrue(ProjectChecksModels.tasks(state, "", true).isEmpty())
    }

    @Test fun historyIsBoundedAndKeepsReadableUnicodeWithoutTerminalColourCodes() {
        val output = "\u001B[31mERROR\u001B[0m café 🦊 日本語\n" + "😀" + "x".repeat(7999)
        val state = JSONObject().put("tasks", JSONArray().put(task("bounded").put("output", output).put("error", "y".repeat(1999) + "😀")))
        val result = ProjectChecksModels.tasks(state, "project-one", true).single()
        assertTrue(result.outputTruncated)
        assertTrue(result.output.length <= 8000)
        assertTrue(result.error.length <= 2000)
        assertFalse(hasBrokenSurrogate(result.output))
        assertFalse(hasBrokenSurrogate(result.error))
        val unicode = ProjectChecksModels.tasks(JSONObject().put("tasks", JSONArray().put(task("unicode").put("output", "\u001B[32mcafé 🦊 日本語\u001B[0m\r\nnext\tline\u0000"))), "project-one", true).single()
        assertEquals("café 🦊 日本語\nnext\tline", unicode.output)
        val many = JSONArray()
        repeat(30) { many.put(task("task-$it")) }
        assertEquals(20, ProjectChecksModels.tasks(JSONObject().put("tasks", many), "project-one", true).size)
    }

    @Test fun approvalIdentityAndDevicePrivacyAreNeverGuessedFromTitles() {
        assertNull(ProjectChecksModels.approval(JSONObject().put("id", "one").put("type", "command").put("title", "Run test")))
        assertNull(ProjectChecksModels.approval(JSONObject().put("type", "project_check")))
        val pending = requireNotNull(ProjectChecksModels.approval(JSONObject().put("id", "approval-one").put("type", "project_check").put("status", "pending")))
        assertEquals("approval-one", pending.id)
        assertNull(pending.taskId)
        val started = requireNotNull(ProjectChecksModels.approval(JSONObject().put("id", "approval-two").put("type", "project_check").put("status", "started").put("result", JSONObject().put("taskId", "task-two"))))
        assertEquals("started", started.status)
        assertEquals("task-two", started.taskId)
        val state = JSONObject().put("devices", JSONArray().put(JSONObject().put("id", "device-one").put("permissions", JSONObject().put("projectAccess", true).put("googleAccess", false))))
        val access = ProjectChecksModels.access(state, "device-one")
        assertTrue(access.paired)
        assertTrue(access.projectAllowed)
        assertFalse(access.historyAllowed)
        assertFalse(ProjectChecksModels.access(state, "missing-device").projectAllowed)
        assertFalse(ProjectChecksModels.access(state, null).projectAllowed)
    }
}
