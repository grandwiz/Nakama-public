package dev.nakama.companion

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

/** Deterministic policy checks only: no microphone, GPS, alarm, network or desktop input. */
class FoundationPolicyTest {
    @Test fun explicitVoiceCommandsReachTheIntendedLocalScreenOrControl() {
        val commands = mapOf(
            "Nakama, show my tasks!" to FoundationCommand.Open("Tasks"),
            "Hey Nakama, open routines." to FoundationCommand.Open("Routines"),
            "open remote desktop" to FoundationCommand.Open("Remote PC"),
            "connect to my pc" to FoundationCommand.ConnectRemote,
            "stop pc control" to FoundationCommand.StopRemote,
            "switch monitor to 2" to FoundationCommand.Monitor("2"),
            "switch monitor Work display" to FoundationCommand.Monitor("work display"),
            "Nakama, type on pc Hello, Mote!" to FoundationCommand.PcInput("text", "Hello, Mote!"),
            "press backspace on pc" to FoundationCommand.PcInput("key", "Backspace"),
            "press enter on pc" to FoundationCommand.PcInput("key", "Enter"),
            "scroll pc up" to FoundationCommand.PcInput("scroll", "-3"),
            "scroll pc down" to FoundationCommand.PcInput("scroll", "3"),
            "show my location" to FoundationCommand.Open("Location"),
            "share my location" to FoundationCommand.StartLocation,
            "stop location tracking" to FoundationCommand.StopLocation,
            "refresh my location" to FoundationCommand.RefreshLocation,
            "listen for nakama" to FoundationCommand.StartWake,
            "stop listening for nakama" to FoundationCommand.StopWake,
            "sync my alarms" to FoundationCommand.SyncAlarms,
            "silence ringing alarms" to FoundationCommand.SilenceAlarms,
        )
        commands.forEach { (text, expected) -> assertEquals(text, expected, FoundationPolicy.command(text)) }
    }

    @Test fun narrationNegationAndUnrecognizedRequestsDoNotBecomeLocalActions() {
        for (text in listOf("Please explain how to start location sharing", "do not start remote desktop", "Nakama, don't stop my alarms", "I read 'share my location' on a webpage", "start remote desktop and deploy everything", "", "switch monitor"))
            assertNull(text, FoundationPolicy.command(text))
    }

    @Test fun wakeRequiresLeadingWholeNameAndPreservesOnlyTheFollowingCommand() {
        assertEquals("show my tasks", FoundationPolicy.wakeCommand("  Hey NAKAMA, show my tasks  "))
        assertEquals("open routines", FoundationPolicy.wakeCommand("Nakama:open routines"))
        assertEquals("", FoundationPolicy.wakeCommand("Nakama!"))
        for (text in listOf("The app Nakama is helpful", "hey there Nakama show tasks", "Nakamaville", "\"Nakama, open tasks\"", "show my tasks"))
            assertNull(text, FoundationPolicy.wakeCommand(text))
        assertEquals(24_000, FoundationPolicy.wakeCommand("Nakama " + "x".repeat(25_000))?.length)
    }

    @Test fun alarmsRespectWeekdaysAndDeviceTimezoneAcrossDateBoundaries() {
        assertEquals(Instant.parse("2026-10-05T06:00:00Z"), FoundationPolicy.nextAlarm("07:00", setOf(1, 2, 3, 4, 5), "Europe/London", Instant.parse("2026-10-02T18:00:00Z")))
        assertEquals(Instant.parse("2026-10-02T22:30:00Z"), FoundationPolicy.nextAlarm("07:30", setOf(6), "Asia/Tokyo", Instant.parse("2026-10-02T15:00:00Z")))
        assertEquals(Instant.parse("2026-10-04T06:00:00Z"), FoundationPolicy.nextAlarm("07:00", setOf(0), "Europe/London", Instant.parse("2026-10-02T18:00:00Z")))
    }

    @Test fun alreadyReachedAlarmInstantIsNotScheduledAgain() {
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), FoundationPolicy.nextAlarm("07:00", (0..6).toSet(), "Europe/London", Instant.parse("2026-10-02T06:00:00Z")))
    }

    @Test fun springGapSkipsNonexistentWallClockTimeToMatchTheHostSchedule() {
        val before = Instant.parse("2026-03-29T00:00:00Z")
        assertEquals(Instant.parse("2026-03-30T00:30:00Z"), FoundationPolicy.nextAlarm("01:30", (0..6).toSet(), "Europe/London", before))
        assertEquals(Instant.parse("2026-04-05T00:30:00Z"), FoundationPolicy.nextAlarm("01:30", setOf(0), "Europe/London", before))
    }

    @Test fun autumnFoldUsesTheFirstOccurrenceAndDoesNotRingTwice() {
        assertEquals(Instant.parse("2026-10-25T00:30:00Z"), FoundationPolicy.nextAlarm("01:30", (0..6).toSet(), "Europe/London", Instant.parse("2026-10-25T00:00:00Z")))
        assertEquals(Instant.parse("2026-10-26T01:30:00Z"), FoundationPolicy.nextAlarm("01:30", (0..6).toSet(), "Europe/London", Instant.parse("2026-10-25T00:40:00Z")))
    }

    @Test fun malformedAlarmSchedulesCannotRegisterAnInstant() {
        val now = Instant.parse("2026-10-02T12:00:00Z")
        for (time in listOf("24:00", "7:30", "12:60", "01:30:00", "")) assertNull(time, FoundationPolicy.nextAlarm(time, setOf(0), "UTC", now))
        assertNull(FoundationPolicy.nextAlarm("07:30", emptySet(), "UTC", now))
        assertNull(FoundationPolicy.nextAlarm("07:30", setOf(-1), "UTC", now))
        assertNull(FoundationPolicy.nextAlarm("07:30", setOf(7), "UTC", now))
        assertNull(FoundationPolicy.nextAlarm("07:30", setOf(1), "Not/AZone", now))
    }

    @Test fun locationBoundsRejectNonfiniteCoordinatesAndUnusableAccuracy() {
        val now = 1_000_000_000L
        assertTrue(FoundationPolicy.validLocation(-90.0, 180.0, 100_000f, now, now))
        assertTrue(FoundationPolicy.validLocation(90.0, -180.0, 0f, now, now))
        for (latitude in listOf(-90.001, 90.001, Double.NaN, Double.POSITIVE_INFINITY)) assertFalse(FoundationPolicy.validLocation(latitude, 0.0, 1f, now, now))
        for (longitude in listOf(-180.001, 180.001, Double.NaN, Double.NEGATIVE_INFINITY)) assertFalse(FoundationPolicy.validLocation(0.0, longitude, 1f, now, now))
        for (accuracy in listOf(-1f, 100_001f, Float.NaN, Float.POSITIVE_INFINITY)) assertFalse(FoundationPolicy.validLocation(0.0, 0.0, accuracy, now, now))
    }

    @Test fun locationFreshnessHonorsFiveMinuteAndClockSkewBoundaries() {
        val now = 1_000_000_000L
        assertTrue(FoundationPolicy.validLocation(51.5, -0.1, 10f, now - 300_000, now))
        assertTrue(FoundationPolicy.validLocation(51.5, -0.1, 10f, now + 60_000, now))
        assertFalse(FoundationPolicy.validLocation(51.5, -0.1, 10f, now - 300_001, now))
        assertFalse(FoundationPolicy.validLocation(51.5, -0.1, 10f, now + 60_001, now))
        assertFalse(FoundationPolicy.validLocation(51.5, -0.1, 10f, 0, now))
    }

    @Test fun remotePointerMapsOnlyTheDisplayedImageWithinLetterboxing() {
        val centre = requireNotNull(RemotePointer.point(500f, 500f, 1000, 1000, 1000, 2000))
        assertEquals(0.5, centre.x, 0.00001); assertEquals(0.5, centre.y, 0.00001)
        val origin = requireNotNull(RemotePointer.point(250f, 0f, 1000, 1000, 1000, 2000))
        assertEquals(0.0, origin.x, 0.00001); assertEquals(0.0, origin.y, 0.00001)
        assertNull(RemotePointer.point(249f, 500f, 1000, 1000, 1000, 2000))
        assertNull(RemotePointer.point(750f, 500f, 1000, 1000, 1000, 2000))
        assertNull(RemotePointer.point(500f, 1000f, 1000, 1000, 1000, 2000))
        val landscape = requireNotNull(RemotePointer.point(540f, 1200f, 1080, 2400, 1920, 1080))
        assertEquals(0.5, landscape.x, 0.00001); assertEquals(0.5, landscape.y, 0.00001)
        assertNull(RemotePointer.point(540f, 895f, 1080, 2400, 1920, 1080))
    }

    @Test fun remotePointerRejectsUnavailableDimensionsAndNonfiniteTouches() {
        assertNull(RemotePointer.point(1f, 1f, 0, 100, 100, 100))
        assertNull(RemotePointer.point(1f, 1f, 100, 0, 100, 100))
        assertNull(RemotePointer.point(1f, 1f, 100, 100, 0, 100))
        assertNull(RemotePointer.point(1f, 1f, 100, 100, 100, -1))
        assertNull(RemotePointer.point(Float.NaN, 1f, 100, 100, 100, 100))
        assertNull(RemotePointer.point(1f, Float.NaN, 100, 100, 100, 100))
        assertNull(RemotePointer.point(Float.POSITIVE_INFINITY, 1f, 100, 100, 100, 100))
    }

    @Test fun wakeAudioGateRemainsBusyUntilAllForegroundAudioOwnersReleaseIt() {
        val talk = Any(); val playback = Any()
        try {
            VoiceAudioGate.set(talk, true); VoiceAudioGate.set(playback, true)
            assertTrue(VoiceAudioGate.busy)
            VoiceAudioGate.set(talk, false); assertTrue(VoiceAudioGate.busy)
            VoiceAudioGate.set(playback, false); assertFalse(VoiceAudioGate.busy)
        } finally { VoiceAudioGate.set(talk, false); VoiceAudioGate.set(playback, false) }
    }
}
