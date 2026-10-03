package dev.nakama.companion

/** A refresh must not cancel a due alarm while Android is delivering its existing PendingIntent. */
internal object AlarmRegistrationPolicy {
    fun preserve(version: String, previousVersion: String?, receiptVersion: String?, receiptStatus: String?, enabled: Boolean, permissions: Boolean, consumed: Boolean): Boolean =
        version.isNotBlank() && previousVersion == version && receiptVersion == version && receiptStatus == "scheduled" && enabled && permissions && !consumed
}
