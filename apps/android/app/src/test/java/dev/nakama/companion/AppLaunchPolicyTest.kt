package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class AppLaunchPolicyTest {
    @Test fun conversationalOwnDeviceLaunchesUseOnlyTheKnownPackage() {
        for (input in listOf("control my phone and open up google chrome", "Nakama, could you please open Google Chrome?", "Please launch Chrome on this phone", "start the Chrome app", "open app Chrome", "would you control this tablet and launch google chrome")) {
            assertEquals(input, "com.android.chrome", (PhoneCommandParser.parse(input) as? PhoneCommandParser.OpenApp)?.packageName)
        }
    }
    @Test fun explicitInstalledAppLabelsKeepExactSelection() {
        assertEquals(NakamaNavigation.App("My Photos"), NavigationPolicy.parse("could you launch app My Photos?"))
        assertEquals(NakamaNavigation.App("Reader"), NavigationPolicy.parse("control my phone and open up Reader"))
        assertEquals(NakamaNavigation.App("org.example.reader"), NavigationPolicy.parse("start app org.example.reader"))
    }
    @Test fun narrationNegationQuotingDestinationsAndExtraEffectsStayUnexecuted() {
        for (input in listOf("How can you open Chrome?", "Can you explain open Chrome", "The model says open Chrome", "do not open Chrome", "could you not open Chrome", "control my phone and do not open Chrome", "\"open Chrome\"", "open `Chrome`", "open app Reader then send", "control my phone and open Chrome and tap buy", "open Chrome on Kitchen tablet", "control my phone and open Chrome on My phone", "could you open Chrome on My phone", "control my phone and open up Google Chrome on Kitchen tablet", "control my phone and open Reader on Missing device", "control my phone and launch app Reader using Kitchen tablet", "please open Chrome\nand delete files", "start an alarm", "set an alarm at 7 am", "open location sharing", "open app Reader without confirmation")) {
            assertNull(input, AppLaunchPolicy.parse(input))
        }
    }
    @Test fun controlWordingDoesNotGrantAVisiblePhoneControlSession() {
        assertNull(AppLaunchPolicy.parse("control my phone"))
        assertNull(AppLaunchPolicy.parse("control my phone and tap buy"))
        assertEquals("com.android.chrome", AppLaunchPolicy.parse("control my phone and open Chrome")?.packageName)
    }
}
