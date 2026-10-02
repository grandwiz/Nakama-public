package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class ProjectChecksRequestGateTest {
    private val identity = HostIdentity("https://example.test:43110", "a".repeat(64), "fixture-token", "device-one", "Fixture host")
    private val scope = ProjectCheckScope(identity, "project-one", true, true, true)

    @Test fun onlyOneCurrentRequestCanComplete() {
        val gate = ProjectChecksRequestGate()
        gate.update(scope)
        val first = requireNotNull(gate.begin())
        assertNull("A double tap must not create a second request", gate.begin())
        assertTrue(gate.accepts(first))
        assertTrue(gate.finish(first))
        val second = requireNotNull(gate.begin())
        assertFalse("An old response cannot complete a newer request", gate.finish(first))
        assertTrue(gate.accepts(second))
        assertNull(gate.begin())
        assertTrue(gate.finish(second))
    }

    @Test fun rePairAndProjectSwitchCannotAdoptLateResultsEvenAfterSwitchingBack() {
        val changes = listOf(
            scope.copy(identity = identity.copy(token = "different-fixture-token")),
            scope.copy(identity = identity.copy(fingerprint = "b".repeat(64))),
            scope.copy(identity = identity.copy(url = "https://another.example.test:43110")),
            scope.copy(identity = identity.copy(deviceId = "device-two")),
            scope.copy(projectId = "project-two")
        )
        for (changed in changes) {
            val gate = ProjectChecksRequestGate()
            gate.update(scope)
            val stale = requireNotNull(gate.begin())
            gate.update(changed)
            gate.update(scope)
            val current = requireNotNull(gate.begin())
            assertFalse(gate.accepts(stale))
            assertFalse(gate.finish(stale))
            assertTrue(gate.accepts(current))
        }
    }

    @Test fun permissionConnectionAndUnpairChangesInvalidateCachedResponseAuthority() {
        val changes = listOf(
            scope.copy(identity = null), scope.copy(projectId = ""),
            scope.copy(projectAllowed = false), scope.copy(historyAllowed = false), scope.copy(connected = false)
        )
        for (changed in changes) {
            val gate = ProjectChecksRequestGate()
            gate.update(scope)
            val pending = requireNotNull(gate.begin())
            gate.update(changed)
            assertFalse(gate.accepts(pending))
            assertFalse(gate.finish(pending))
            if (!changed.projectAllowed || !changed.connected || changed.identity == null || changed.projectId.isBlank()) {
                assertNull(gate.begin())
            } else {
                assertNotNull("Google-disabled devices retain project-check discovery/request access", gate.begin())
            }
        }
    }

    @Test fun disposalInvalidatesPendingWorkButIdenticalStateRefreshDoesNot() {
        val gate = ProjectChecksRequestGate()
        gate.update(scope)
        val pending = requireNotNull(gate.begin())
        gate.update(scope.copy())
        assertTrue(gate.accepts(pending))
        gate.invalidate()
        assertFalse(gate.accepts(pending))
        assertFalse(gate.finish(pending))
    }
}
