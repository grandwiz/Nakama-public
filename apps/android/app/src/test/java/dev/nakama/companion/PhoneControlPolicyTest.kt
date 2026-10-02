package dev.nakama.companion

import org.junit.Assert.*
import org.junit.Test

class PhoneControlPolicyTest {
    @Test fun sensitiveAuthenticationAndPaymentControlsAreExcluded() {
        listOf("Password", "Enter your one-time code", "OTP code", "Verification code", "cardNumber", "Credit card", "CVV", "Payment", "Your PIN").forEach { assertTrue(it, PhoneControlPolicy.sensitiveLabel(it)) }
        assertFalse(PhoneControlPolicy.sensitiveLabel("Message Nayan"))
    }
    @Test fun deploymentAndProjectDeletionAlwaysNeedHuman() {
        listOf("Deploy", "Deploy preview", "Publish site", "Delete project", "Delete this project", "remove_repository", "Promote to production").forEach { assertTrue(it, PhoneControlPolicy.needsHuman(it)) }
        assertFalse(PhoneControlPolicy.needsHuman("Send message"))
    }
    @Test fun visibleTextIsBoundedAndUnlabelledCodesOmitted() {
        assertEquals("", PhoneControlPolicy.observableLabel("Verification code: 123456"))
        assertEquals("[numeric value omitted]", PhoneControlPolicy.observableLabel("Your code is 123456"))
        assertEquals("[numeric value omitted]", PhoneControlPolicy.observableLabel("4111 1111 1111 1111"))
        assertEquals(160, PhoneControlPolicy.observableLabel("a".repeat(1000)).length)
        assertEquals("Send", PhoneControlPolicy.observableLabel("Send"))
    }
}
