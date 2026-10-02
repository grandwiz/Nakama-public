package dev.nakama.companion

/** Local matching only: these labels never become model context or a host payload. */
object MonitorPolicy {
    fun packageAllowed(value: String): Boolean = value.length <= 200 &&
        value.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+")) &&
        value != "dev.nakama.companion" && !value.startsWith("com.android.") &&
        !value.startsWith("com.google.android.permissioncontroller") &&
        listOf("packageinstaller", "systemui", "settings").none { value.contains(it, true) }

    fun evaluate(contains: String, excludes: String, labels: List<String>, sensitive: Boolean, truncated: Boolean): String {
        if (sensitive) return "sensitive"
        if (truncated || contains.isBlank() || contains.length > 300 || excludes.length > 300) return "unavailable"
        val visible = labels.joinToString("\n")
        return if (visible.contains(contains, ignoreCase = true) && (excludes.isBlank() || !visible.contains(excludes, ignoreCase = true))) "match" else "no_match"
    }

    fun consentCurrent(expectedScope: String, currentScope: String?, expiresAt: Long, now: Long,
        expectedPackage: String, actualPackage: String, expectedCondition: String, actualCondition: String,
        status: String): Boolean = expectedScope == currentScope && now < expiresAt &&
        expectedPackage == actualPackage && expectedCondition == actualCondition && status == "active"
}
