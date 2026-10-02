package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class DeviceRoutingTest {
    @Test fun ordinaryCommandsKeepTheirIssuingDevice() {
        assertNull(DeviceCommandRouting.parse("open Netflix"))
        assertNull(DeviceCommandRouting.parse("set a ten minute timer"))
        assertNull(DeviceCommandRouting.parse("what time is it"))
        assertEquals(LocalClockCommand.CreateTimer(600), LocalClockCommands.parse("set a ten minute timer"))
    }
    @Test fun onlyAnExplicitSuffixRedirectsAppAndTimerRequests() {
        val app = DeviceCommandRouting.parse("Nakama, open Netflix on Kitchen Tablet")!!
        assertEquals("Kitchen Tablet", app.targetName); assertEquals("Netflix", app.appName); assertEquals("open_app", app.command)
        val timer = DeviceCommandRouting.parse("set a ten minute timer named tea on Bedroom Phone")!!
        assertEquals(LocalClockCommand.CreateTimer(600, "tea"), timer.timer); assertEquals("Bedroom Phone", timer.targetName)
        assertTrue(DeviceCommandRouting.isThisDevice("this tablet"))
        assertNull(DeviceCommandRouting.parse("They said open Netflix on Kitchen Tablet"))
        assertNull(DeviceCommandRouting.parse("don't open Netflix on Kitchen Tablet"))
    }
    @Test fun unknownAmbiguousAndDisconnectedTargetsNeverChooseAnotherDevice() {
        val devices = listOf(DeviceTarget("phone", "Phone", "android", true), DeviceTarget("tablet", "Tablet", "android", false))
        assertEquals("phone", DeviceCommandRouting.resolve("PHONE", devices).id)
        val desktop = DeviceTarget("desktop", "Nakama PC", "desktop", true)
        for (name in listOf("pc", "desktop", "this pc")) assertEquals(desktop, DeviceCommandRouting.resolve(name, devices + desktop))
        assertThrows(IllegalArgumentException::class.java) { DeviceCommandRouting.resolve("Unknown", devices) }
        assertThrows(IllegalArgumentException::class.java) { DeviceCommandRouting.resolve("Tablet", devices) }
        assertThrows(IllegalArgumentException::class.java) { DeviceCommandRouting.resolve("Phone", devices + devices[0].copy(id = "another")) }
    }
    @Test fun incompleteOrCompoundTargetCommandsDoNotFallBackToLocalExecution() {
        for (text in listOf("pause timer on Phone", "set a negative minute timer on Phone", "open Netflix and then send a message on Phone"))
            assertTrue(text, DeviceCommandRouting.parse(text)!!.error.isNotBlank())
    }
    @Test fun sharedHistoryAndMissingRecipientsAreNeverDelivered() {
        assertTrue(DeviceDelivery.addressedTo("phone", "phone"))
        assertFalse(DeviceDelivery.addressedTo("tablet", "phone"))
        assertFalse(DeviceDelivery.addressedTo("desktop", "phone"))
        assertFalse(DeviceDelivery.addressedTo("", "phone"))
        assertFalse(DeviceDelivery.addressedTo("", ""))
    }
    @Test fun remoteTimerReceiptScopeSeparatesOriginAndPairing() {
        val identity = HostIdentity("https://fixture.invalid", "a".repeat(64), "synthetic", "phone", "Fixture")
        val key = RemotePhoneTimers.key(identity, "tablet", "request")
        assertEquals(key, RemotePhoneTimers.key(identity.copy(token = "rotated"), "tablet", "request"))
        assertNotEquals(key, RemotePhoneTimers.key(identity, "desktop", "request"))
        assertNotEquals(key, RemotePhoneTimers.key(identity.copy(deviceId = "other"), "tablet", "request"))
        assertNotEquals(key, RemotePhoneTimers.key(identity.copy(fingerprint = "b".repeat(64)), "tablet", "request"))
    }
}
