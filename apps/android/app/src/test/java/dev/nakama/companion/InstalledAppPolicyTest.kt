package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class InstalledAppPolicyTest {
    @Test fun namesSortButDuplicateLabelsKeepExactIdentity() {
        val apps = InstalledAppPolicy.normalize(listOf(InstalledApp("com.fixture.two", "Reader"), InstalledApp("com.fixture.one", "Reader"), InstalledApp("com.fixture.mail", "Mail")))
        assertEquals(listOf("com.fixture.mail", "com.fixture.one", "com.fixture.two"), apps.map { it.packageName })
        assertEquals("Reader (com.fixture.two)", InstalledAppPolicy.choiceLabel(apps[2], apps))
        assertEquals("Mail", InstalledAppPolicy.choiceLabel(apps[0], apps))
    }
    @Test fun invalidOrRemovedAppsCannotRemainSelected() {
        val apps = InstalledAppPolicy.normalize(listOf(InstalledApp("com.fixture.reader", "Reader"), InstalledApp("com.fixture.reader", "Duplicate"), InstalledApp("*", "Invalid")))
        assertEquals(1, apps.size)
        assertTrue(InstalledAppPolicy.selected(apps, "com.fixture.reader"))
        assertFalse(InstalledAppPolicy.selected(apps, "com.fixture.other"))
        assertFalse(InstalledAppPolicy.selected(emptyList(), "com.fixture.reader"))
    }
    @Test fun misleadingFormattingIsRemovedAndCatalogIsBounded() {
        assertEquals("SafeName", InstalledAppPolicy.normalize(listOf(InstalledApp("com.fixture.app", " Safe\u202eName\n "))).single().label)
        assertEquals(1000, InstalledAppPolicy.normalize((1..1200).map { InstalledApp("com.fixture.app$it", "App $it") }).size)
    }
}
