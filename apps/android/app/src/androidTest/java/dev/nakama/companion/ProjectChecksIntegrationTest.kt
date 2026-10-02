package dev.nakama.companion

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

internal fun projectCheckFixture(): JSONObject {
    val encoded = InstrumentationRegistry.getArguments().getString("pairing")
        ?: error("Pass the disposable integration fixture as -e pairing.")
    return JSONObject(String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)).also {
        require(it.getString("url") == "https://127.0.0.1:43120") { "Only the isolated loopback Android fixture is allowed." }
    }
}

internal fun projectCheckIdentity(fixture: JSONObject, identity: JSONObject): HostIdentity = HostIdentity(
    fixture.getString("url"), fixture.getString("fingerprint"), identity.getString("token"),
    identity.getString("deviceId"), identity.getString("hostName")
)

internal fun pairProjectCheckFixture(fixture: JSONObject, ticketKey: String): HostIdentity {
    val paired = HostClient(fixture.getString("url"), fixture.getString("fingerprint")).request(
        "POST", "/api/pair", JSONObject().put("ticket", fixture.getString(ticketKey))
            .put("platform", "android").put("name", "Android check test $ticketKey")
    )
    return projectCheckIdentity(fixture, paired)
}

@RunWith(AndroidJUnit4::class)
class ProjectChecksIntegrationTest {
    private fun expectStatus(status: Int, action: () -> Unit) {
        val failure = assertThrows(HostException::class.java) { action() }
        assertEquals(status, failure.status)
    }

    @Test fun discoverPreviewAndRequestAlwaysWaitForDesktopApproval() {
        val fixture = projectCheckFixture()
        val identity = pairProjectCheckFixture(fixture, "checksTicket")
        val client = HostClient(identity)
        val projects = fixture.getJSONObject("checksFixture")
        val projectId = projects.getString("projectId")
        val route = "/api/projects/$projectId/checks"
        val catalogue = ProjectChecksModels.catalogue(client.request("GET", route))
        assertTrue(catalogue.supported)
        assertTrue("Installed Node/npm must be discoverable for this fixture", catalogue.runtimeAvailable)
        assertFalse(catalogue.active)
        assertEquals(setOf("test", "lint"), catalogue.checks.map { it.name }.toSet())
        val test = catalogue.checks.single { it.name == "test" }
        assertEquals("node fixture-pre.cjs", test.preScript)
        assertEquals("node fixture-test.cjs", test.script)
        assertEquals("node fixture-post.cjs", test.postScript)
        assertFalse(test.truncated)

        val missing = ProjectChecksModels.catalogue(client.request("GET", "/api/projects/${projects.getString("missingProjectId")}/checks"))
        assertFalse(missing.supported)
        assertTrue(missing.checks.isEmpty())
        assertTrue("Unavailable checks need an explanation", missing.detail.isNotBlank())
        assertNull("A missing manifest cannot authorise a check request", missing.manifestHash)
        val unsupported = ProjectChecksModels.catalogue(client.request("GET", "/api/projects/${projects.getString("unsupportedProjectId")}/checks"))
        assertFalse(unsupported.supported)
        assertTrue(unsupported.checks.isEmpty())
        assertTrue(unsupported.detail.isNotBlank())

        val before = client.request("GET", "/api/state")
        val history = ProjectChecksModels.tasks(before, projectId, true)
        assertEquals(3, history.size)
        assertEquals(0, history.single { it.id == "fixture-check-completed" }.exitCode)
        assertEquals(7, history.single { it.id == "fixture-check-failed" }.exitCode)
        val interrupted = history.single { it.id == "fixture-check-interrupted" }
        assertEquals("interrupted", interrupted.status)
        assertNull(interrupted.exitCode)
        assertNull(interrupted.signal)
        assertTrue(history.single { it.id == "fixture-check-completed" }.output.contains("café 🦊 日本語"))

        val requestBody = ProjectChecksModels.requestBody(catalogue, "lint")
        assertEquals(setOf("name", "manifestHash"), requestBody.keys().asSequence().toSet())
        val response = client.request("POST", "$route/request", requestBody)
        val approval = requireNotNull(ProjectChecksModels.approval(response))
        assertEquals("pending", approval.status)
        assertNull(approval.taskId)
        assertEquals("project_check", response.getString("type"))
        assertTrue(response.getString("description").contains("not a sandbox"))
        expectStatus(403) { client.request("POST", "/api/approvals/${approval.id}/resolve", JSONObject().put("approved", true)) }
        val after = client.request("GET", "/api/state")
        assertEquals("pending", after.objects("approvals").single { it.getString("id") == approval.id }.getString("status"))
        assertEquals(before.objects("tasks").map { it.getString("id") }.toSet(), after.objects("tasks").map { it.getString("id") }.toSet())
        assertFalse(ProjectChecksModels.catalogue(client.request("GET", route)).active)
        expectStatus(409) { client.request("POST", "$route/request", JSONObject().put("name", "test").put("manifestHash", "0".repeat(64))) }
        expectStatus(400) { client.request("POST", "$route/request", JSONObject().put("name", "deploy").put("manifestHash", catalogue.manifestHash)) }
    }

    @Test fun projectAndGooglePermissionBoundariesRemainDistinct() {
        val fixture = projectCheckFixture()
        val projectId = fixture.getJSONObject("checksFixture").getString("projectId")
        val route = "/api/projects/$projectId/checks"
        val restrictedIdentity = projectCheckIdentity(fixture, fixture.getJSONObject("restrictedIdentity"))
        val restricted = HostClient(restrictedIdentity)
        expectStatus(403) { restricted.request("GET", route) }
        expectStatus(403) { restricted.request("POST", "$route/request", JSONObject().put("name", "test").put("manifestHash", "0".repeat(64))) }
        val hidden = restricted.request("GET", "/api/state")
        for (field in listOf("projects", "tasks", "approvals", "messages")) assertTrue(field, hidden.objects(field).isEmpty())
        val blockedAccess = ProjectChecksModels.access(hidden, restrictedIdentity.deviceId)
        assertTrue(blockedAccess.paired)
        assertFalse(blockedAccess.projectAllowed)
        assertFalse(blockedAccess.historyAllowed)

        val privateIdentity = projectCheckIdentity(fixture, fixture.getJSONObject("privateIdentity"))
        val privateClient = HostClient(privateIdentity)
        val catalogue = ProjectChecksModels.catalogue(privateClient.request("GET", route))
        assertTrue(catalogue.supported)
        val response = privateClient.request("POST", "$route/request", ProjectChecksModels.requestBody(catalogue, "test"))
        assertEquals("pending", response.getString("status"))
        val privateState = privateClient.request("GET", "/api/state")
        assertTrue(privateState.objects("projects").isNotEmpty())
        assertTrue(privateState.objects("tasks").isEmpty())
        assertTrue(privateState.objects("approvals").isEmpty())
        val privateAccess = ProjectChecksModels.access(privateState, privateIdentity.deviceId)
        assertTrue(privateAccess.projectAllowed)
        assertFalse(privateAccess.historyAllowed)
        assertTrue(ProjectChecksModels.tasks(privateState, projectId, privateAccess.historyAllowed).isEmpty())
    }
}
