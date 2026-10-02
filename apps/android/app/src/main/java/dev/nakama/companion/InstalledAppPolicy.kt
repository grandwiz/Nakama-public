package dev.nakama.companion

/** Labels are display data only. Every operation retains the exact package identifier. */
data class InstalledApp(val packageName: String, val label: String)
object InstalledAppPolicy {
    fun normalize(apps: List<InstalledApp>): List<InstalledApp> = apps
        .filter { it.packageName.length <= 200 && it.packageName.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+")) }
        .map { it.copy(label = it.label.replace(Regex("[\\p{Cc}\\p{Cf}]"), "").trim().take(120).ifBlank { "Unnamed app" }) }
        .distinctBy { it.packageName }
        .sortedWith(compareBy<InstalledApp> { it.label.lowercase() }.thenBy { it.packageName }).take(1000)
    fun choiceLabel(app: InstalledApp, apps: List<InstalledApp>): String =
        if (apps.count { it.label == app.label } > 1) "${app.label} (${app.packageName})" else app.label
    fun selected(apps: List<InstalledApp>, target: String): Boolean = apps.any { it.packageName == target }
}
