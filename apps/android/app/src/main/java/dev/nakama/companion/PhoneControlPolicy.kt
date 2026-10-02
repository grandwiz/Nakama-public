package dev.nakama.companion

/** Conservative UI hints, not an assertion that arbitrary apps can be classified perfectly. */
object PhoneControlPolicy {
    private fun normalise(value: String) = value.replace(Regex("([a-z])([A-Z])"), "$1 $2").lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
    private val sensitive = Regex("\\b(password|passcode|passphrase|otp|totp|pin|cvv|cvc|payment|payments|checkout|billing|biometric|authentication|authenticator)\\b|\\b(one time|verification|security|authentication) (password|code)\\b|\\b(credit|debit) card\\b|\\b(card|account|routing) number\\b|\\b(expiry|expiration) date\\b")
    private val highImpact = Regex("\\b(deploy|deployment|deployments|publish|publishing)\\b|\\b(delete|remove|destroy|erase) (this |the )?(project|repository|workspace)\\b|\\b(project|repository|workspace) (deletion|removal)\\b|\\b(release|promote) (to )?production\\b")
    fun sensitiveLabel(value: String) = sensitive.containsMatchIn(normalise(value))
    fun needsHuman(value: String) = highImpact.containsMatchIn(normalise(value))
    fun observableLabel(value: String): String {
        if (sensitiveLabel(value)) return ""
        // Unlabelled code/card strings are not useful control labels and should not leave the phone.
        if (Regex("(?<![0-9])[0-9]{4,8}(?![0-9])|(?:[0-9][ -]?){13,19}").containsMatchIn(value)) return "[numeric value omitted]"
        return value.replace(Regex("[\\p{Cc}&&[^\\n\\t]]"), "").take(160)
    }
}
