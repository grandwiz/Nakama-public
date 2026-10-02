package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class NavigationPolicyTest {
    @Test fun delayedNavigationIsInvalidatedByNewInputPageChangesOrANewerRequest() {
        val gate = NavigationReceiptGate()
        val first = gate.begin(); assertTrue(gate.accepts(first))
        gate.invalidate(); assertFalse(gate.accepts(first))
        val next = gate.begin(); val latest = gate.begin()
        assertFalse(gate.accepts(next)); assertTrue(gate.accepts(latest))
        gate.invalidate(); assertFalse(gate.accepts(latest))
    }
    @Test fun explicitPageRoutesCoverMainAndToolAreasWithoutAHost() {
        val routes = mapOf(
            "open home" to NakamaNavigation.Page("Home"), "please show my projects" to NakamaNavigation.Page("Projects"),
            "Nakama, take me to chat!" to NakamaNavigation.Page("Chat"), "go to the agent office" to NakamaNavigation.Page("Tools", "Agent office"),
            "show agents" to NakamaNavigation.Page("Tools", "Agent office"), "open core memory" to NakamaNavigation.Page("Tools", "Core Memory"),
            "open tasks" to NakamaNavigation.Page("Tools", "Tasks"), "open routines" to NakamaNavigation.Page("Tools", "Routines"),
            "show my remote desktop" to NakamaNavigation.Page("Tools", "Remote PC"), "open location" to NakamaNavigation.Page("Tools", "Location"),
            "open wake word" to NakamaNavigation.Page("Tools", "Wake word"), "open settings" to NakamaNavigation.Page("Device"),
            "open personal" to NakamaNavigation.Page("Personal"), "show AI usage" to NakamaNavigation.Page("Usage"),
        )
        routes.forEach { (request, expected) -> assertEquals(request, expected, NavigationPolicy.parse(request)) }
    }
    @Test fun androidAndAppRequestsHaveDistinctTargets() {
        assertEquals(NakamaNavigation.Android("home"), NavigationPolicy.parse("go to android home"))
        assertEquals(NakamaNavigation.Android("settings"), NavigationPolicy.parse("open Android settings"))
        assertEquals(NakamaNavigation.Android("back"), NavigationPolicy.parse("Android back"))
        assertEquals(NakamaNavigation.Android("recents"), NavigationPolicy.parse("show recent apps"))
        assertEquals(NakamaNavigation.Android("notifications"), NavigationPolicy.parse("show phone notifications"))
        assertEquals(NakamaNavigation.App("My Photos"), NavigationPolicy.parse("open app My Photos"))
        assertEquals(NakamaNavigation.App("com.example.reader"), NavigationPolicy.parse("open app com.example.reader"))
    }
    @Test fun narrationNegationCompoundCommandsAndLinksAreNotNavigation() {
        for (request in listOf("don't open agents", "I would like to explain open home", "open agents and delete a project", "open https://example.com", "go to /api/settings", "open app Reader\nthen tap Send", "open app \"Reader\"", "Tell me what 'open settings' does", "show nearby shops", "open location sharing"))
            assertNull(request, NavigationPolicy.parse(request))
    }
    @Test fun hostOutcomesUseOnlyKnownPagesAndNeverUrlsOrOperatingSystemCommands() {
        assertEquals(NakamaNavigation.Page("Tools", "Agent office"), NavigationPolicy.hostTarget("agent-office"))
        assertEquals(NakamaNavigation.Page("Tools", "Tasks"), NavigationPolicy.hostTarget("boards"))
        assertEquals(NakamaNavigation.Page("Chat"), NavigationPolicy.hostTarget("assistant"))
        for (target in listOf("https://evil.invalid", "android home", "open-app", "connections", "activity", "../devices")) assertNull(NavigationPolicy.hostTarget(target))
    }
    @Test fun visibleAppResolutionDoesNotGuessPartialNamesOrChooseAnAmbiguousApp() {
        val apps = listOf("Reader" to "example.reader", "Reader" to "work.reader", "Reader Pro" to "example.pro", "Reader" to "example.reader")
        assertEquals(2, NavigationPolicy.matchingApps("reader", apps).size)
        assertEquals(listOf("Reader" to "work.reader"), NavigationPolicy.matchingApps("work.reader", apps))
        assertTrue(NavigationPolicy.matchingApps("Read", apps).isEmpty())
        assertTrue(NavigationPolicy.matchingApps("Reader and send", apps).isEmpty())
    }
}
