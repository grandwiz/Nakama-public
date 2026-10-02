package dev.nakama.companion

/** Conservative grammar for the owner's chat/voice input only. Never run on model replies or app text. */
object PhoneCommandParser {
    sealed interface Command
    data class Call(val target: String) : Command
    data class Message(val target: String, val message: String, val whatsapp: Boolean) : Command
    data class OpenApp(val packageName: String, val name: String) : Command
    data class Unsupported(val explanation: String) : Command

    fun parse(input: String): Command? {
        val text = input.trim().replace(Regex("^(?:hey\\s+)?nakama[,:]?\\s+", RegexOption.IGNORE_CASE), "").replace(Regex("^please\\s+", RegexOption.IGNORE_CASE), "")
        Regex("^call\\s+(.+?)\\s+on\\s+(whatsapp|discord)[.!]?$", RegexOption.IGNORE_CASE).matchEntire(text)?.let {
            return Unsupported("${it.groupValues[2]} calling by contact name is not implemented yet. Open that app and place the call there. I have not placed a normal phone call.")
        }
        Regex("^call\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE).matchEntire(text)?.let {
            val target = it.groupValues[1].trim()
            if (target.length in 1..100) return Call(target)
        }
        Regex("^(?:message|text)\\s+(.+?)\\s+on\\s+(whatsapp|sms|discord)\\s*[:,]?\\s+(.+)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).matchEntire(text)?.let {
            val target = it.groupValues[1].trim(); val body = it.groupValues[3].trim()
            if (target.length !in 1..100 || body.isBlank() || body.length > 10000) return Unsupported("Use a recipient and a message shorter than 10,000 characters.")
            if (it.groupValues[2].equals("discord", true)) return Unsupported("Discord username messaging is not implemented yet. Your requested recipient is $target. Your message is: $body\nOpen Discord to send it; nothing has been sent.")
            return Message(target, body, it.groupValues[2].equals("whatsapp", true))
        }
        Regex("^(?:message|text)\\s+([^:]+):\\s*(.+)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).matchEntire(text)?.let {
            if (it.groupValues[1].length <= 100 && it.groupValues[2].length <= 10000) return Message(it.groupValues[1].trim(), it.groupValues[2].trim(), false)
        }
        Regex("^open\\s+(whatsapp|discord|gmail|calendar|chrome|youtube)[.!]?$", RegexOption.IGNORE_CASE).matchEntire(text)?.let {
            val name = it.groupValues[1].lowercase()
            val packages = mapOf("whatsapp" to "com.whatsapp", "discord" to "com.discord", "gmail" to "com.google.android.gm", "calendar" to "com.google.android.calendar", "chrome" to "com.android.chrome", "youtube" to "com.google.android.youtube")
            return OpenApp(packages.getValue(name), name)
        }
        return null
    }
    fun isPhoneNumber(value: String) = value.trim().matches(Regex("\\+?[0-9 ()-]{3,30}"))
}

data class ContactChoice(val name: String, val number: String)
