package dev.nakama.companion

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong

sealed interface LocalClockCommand {
    data object Greeting : LocalClockCommand
    data object Time : LocalClockCommand
    data object Date : LocalClockCommand
    data object Open : LocalClockCommand
    data class ListTimers(val title: String? = null) : LocalClockCommand
    data class CreateTimer(val seconds: Long, val title: String = "") : LocalClockCommand
    data class ChangeTimer(val action: String, val title: String? = null) : LocalClockCommand
    data class Invalid(val explanation: String) : LocalClockCommand
}

/** Exact direct-user commands only. Explanations, quotations and extra actions never partly execute. */
object LocalClockCommands {
    private val small = listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    private val tens = mapOf("twenty" to 20, "thirty" to 30, "forty" to 40, "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90)
    fun parse(input: String): LocalClockCommand? {
        if (input.length > 500) return null
        val value = input.trim().lowercase(Locale.ROOT).replace('’', '\'')
            .replace(Regex("^(?:hey\\s+)?nakama[,:.!?]?\\s+"), "")
            .removePrefix("please ").trimEnd('.', '!', '?').removeSuffix(" please").trim()
        if (value in setOf("hello", "hi", "hey", "hello nakama", "hi nakama", "good morning", "good afternoon", "good evening", "how are you", "hello how are you", "hi how are you")) return LocalClockCommand.Greeting
        if (value in setOf("what time is it", "what time is it now", "what's the time", "what is the time", "tell me the time", "tell me what time it is", "current time", "time")) return LocalClockCommand.Time
        if (value in setOf("what's the date", "what is the date", "what is today's date", "what's today's date", "what day is it", "what day is it today", "today's date")) return LocalClockCommand.Date
        if (value in setOf("open clock", "show clock", "open the clock", "open timers", "show timers", "open my timers")) return LocalClockCommand.Open
        if (value in setOf("list timers", "list my timers", "show my timers", "how much time is left", "how long is left", "how much time is left on my timer", "how much time is left on the timer", "timer status")) return LocalClockCommand.ListTimers()
        Regex("^(?:how much time|how long) is left on (?:the |my )?(.+?) timer$").matchEntire(value)?.let {
            return LocalClockCommand.ListTimers(it.groupValues[1])
        }
        Regex("^(pause|resume|cancel|stop|dismiss) (?:the |my )?(?:(.+?) )?timer$").matchEntire(value)?.let {
            val name = it.groupValues[2].takeIf(String::isNotBlank)
            if (name != null && !safeName(name)) return null
            return LocalClockCommand.ChangeTimer(it.groupValues[1], name)
        }
        val create = Regex("^(?:set|start|create) (?:a |an )?(.+?) timer(?: (?:called|named) (.+))?$").matchEntire(value)
        val forDuration = Regex("^(?:set|start|create) (?:a |an )?timer for (.+?)(?: (?:called|named) (.+))?$").matchEntire(value)
        val match = create ?: forDuration ?: return null
        val title = match.groupValues[2]
        if (title.isNotBlank() && !safeName(title)) return LocalClockCommand.Invalid("Use a short timer name without another command.")
        val seconds = durationSeconds(match.groupValues[1])
            ?: return LocalClockCommand.Invalid("Choose a timer from one second to seven days, for example: set a ten minute timer.")
        return LocalClockCommand.CreateTimer(seconds, title)
    }
    private fun safeName(value: String) = value.length in 1..80 && value.matches(Regex("[\\p{L}\\p{N}][\\p{L}\\p{N} '_-]*")) &&
        !Regex("\\b(?:and then|then|and (?:set|start|create|resume|pause|dismiss|send|call|delete|open|cancel|stop)|but|after|do not|don't|dont|never|without)\\b").containsMatchIn(value)
    private fun number(value: String): Double? {
        if (value.trim().startsWith("-") || value.trim().startsWith("+")) return null
        val clean = value.trim().replace('-', ' ')
        clean.toDoubleOrNull()?.let { return it.takeIf { number -> number.isFinite() && number >= 0 } }
        if (clean in setOf("a", "an", "one")) return 1.0
        if (clean in setOf("half", "half a", "half an")) return 0.5
        if (clean in setOf("quarter", "a quarter", "quarter of an", "a quarter of an")) return 0.25
        val words = clean.split(' ').filter(String::isNotBlank)
        if (words.size == 1) return small.indexOf(words[0]).takeIf { it >= 0 }?.toDouble() ?: tens[words[0]]?.toDouble()
        if (words.size == 2 && words[0] in tens && words[1] in small.subList(1, 10)) return (tens.getValue(words[0]) + small.indexOf(words[1])).toDouble()
        if (words.size in 2..5 && words[0] in small.subList(1, 10) && words[1] == "hundred") {
            val rest = words.drop(2).joinToString(" ").removePrefix("and ")
            return small.indexOf(words[0]) * 100.0 + if (rest.isBlank()) 0.0 else number(rest)?.takeIf { it < 100 } ?: return null
        }
        return null
    }
    fun durationSeconds(value: String): Long? {
        var remaining = value.trim()
        var total = 0.0
        var parts = 0
        val piece = Regex("^(.+?)\\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b")
        while (remaining.isNotBlank()) {
            val part = piece.find(remaining) ?: return null
            val amount = number(part.groupValues[1]) ?: return null
            val unit = part.groupValues[2]
            total += amount * if (unit.startsWith("h")) 3600 else if (unit.startsWith("m")) 60 else 1
            if (++parts > 3 || total > 604_800) return null
            remaining = remaining.substring(part.range.last + 1).trim().removePrefix("and ").trim()
        }
        val seconds = total.roundToLong()
        return seconds.takeIf { parts > 0 && it in 1..604_800 && kotlin.math.abs(total - it) < 0.0001 }
    }
    fun immediate(command: LocalClockCommand, now: Instant, zone: ZoneId): String? = when (command) {
        LocalClockCommand.Greeting -> "Hello! I'm here. What can I help with?"
        LocalClockCommand.Time -> "It's ${DateTimeFormatter.ofPattern("h:mm a", Locale.UK).format(now.atZone(zone)).lowercase(Locale.UK)}."
        LocalClockCommand.Date -> "It's ${DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.UK).format(now.atZone(zone))}."
        else -> null
    }
}

data class LocalClockReply(val text: String, val openClock: Boolean = false)
