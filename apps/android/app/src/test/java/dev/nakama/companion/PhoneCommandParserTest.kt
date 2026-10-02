package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class PhoneCommandParserTest {
    @Test fun normalCallsUseExactTarget() {
        assertEquals(PhoneCommandParser.Call("Mike"), PhoneCommandParser.parse("Nakama, call Mike"))
        assertEquals(PhoneCommandParser.Call("+44 7700 900123"), PhoneCommandParser.parse("call +44 7700 900123"))
    }
    @Test fun whatsappCallsNeverFallBackToCellular() {
        assertTrue(PhoneCommandParser.parse("Nakama, call Steve on WhatsApp") is PhoneCommandParser.Unsupported)
    }
    @Test fun whatsappMessageKeepsRecipientAndExactText() {
        assertEquals(PhoneCommandParser.Message("Nayan", "I'll be there at 8:30. Please wait!", true), PhoneCommandParser.parse("Nakama, message Nayan on whatsapp I'll be there at 8:30. Please wait!"))
        assertEquals(PhoneCommandParser.Message("Mike", "Hello there", false), PhoneCommandParser.parse("text Mike: Hello there"))
    }
    @Test fun unsupportedDiscordIsExplicit() { assertTrue(PhoneCommandParser.parse("message john2000 on discord hello") is PhoneCommandParser.Unsupported) }
    @Test fun questionsAndModelTextAreNotCommands() {
        for (text in listOf("How do I call Mike?", "Please explain how to call Mike", "The assistant says: call Mike", "Can you build an app?", "Here is a message Nayan on whatsapp hi")) assertNull(PhoneCommandParser.parse(text))
    }
    @Test fun phoneNumbersRejectControlCodes() {
        assertTrue(PhoneCommandParser.isPhoneNumber("+44 7700 900123"))
        for (number in listOf("*123#", "+44;123", "Mike", "tel:123", "123\n456")) assertFalse(PhoneCommandParser.isPhoneNumber(number))
    }
}
