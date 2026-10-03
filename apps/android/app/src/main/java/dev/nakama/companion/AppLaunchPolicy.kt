package dev.nakama.companion

/** Exact owner command grammar only; never apply to model replies or observed app content. */
internal object AppLaunchPolicy {
    private val packages = mapOf("whatsapp" to "com.whatsapp", "discord" to "com.discord", "gmail" to "com.google.android.gm", "calendar" to "com.google.android.calendar", "chrome" to "com.android.chrome", "google chrome" to "com.android.chrome", "youtube" to "com.google.android.youtube")
    data class Request(val label: String, val packageName: String?)
    fun parse(input: String): Request? {
        if (input.length > 350 || input.any(Char::isISOControl) || Regex("[\"“”`<>]").containsMatchIn(input)) return null
        var text = input.trim().replace(Regex("^(?:hey\\s+)?nakama[,:]?\\s+", RegexOption.IGNORE_CASE), "")
        repeat(4) { text = text.replace(Regex("^(?:please[, ]+|(?:can|could|would) you\\s+)", RegexOption.IGNORE_CASE), "") }
        text = text.trimEnd('.', '!', '?').trim().replace(Regex("[, ]+please$", RegexOption.IGNORE_CASE), "")
        val controlled = Regex("^control (?:my|this) (?:phone|tablet|device) and ", RegexOption.IGNORE_CASE).find(text)
        if (controlled != null) text = text.substring(controlled.value.length)
        val match = Regex("^(?:open(?: up)?|launch|start)\\s+(?:the\\s+)?(app\\s+)?([\\p{L}\\p{N}][\\p{L}\\p{N} ._-]{0,99}?)(?:\\s+on this (?:phone|tablet|device))?$", RegexOption.IGNORE_CASE).matchEntire(text) ?: return null
        val label = match.groupValues[2].trim().replace(Regex("\\s+app$", RegexOption.IGNORE_CASE), "")
        if (Regex("\\b(?:and|then|but|except|without|not|never|don't|do)\\b", RegexOption.IGNORE_CASE).containsMatchIn(label)) return null
        // A remote destination must reach the exact-device host route, never a local app lookup.
        if (Regex("\\b(?:on|using)\\s+", RegexOption.IGNORE_CASE).containsMatchIn(label)) return null
        val known = packages[label.lowercase()]
        if (known == null && match.groupValues[1].isBlank() && controlled == null) return null
        return Request(label, known)
    }
}
