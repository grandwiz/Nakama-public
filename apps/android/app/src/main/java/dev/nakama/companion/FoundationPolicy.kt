package dev.nakama.companion

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

sealed interface FoundationCommand {
    data class Open(val page: String) : FoundationCommand
    data class Monitor(val selection: String) : FoundationCommand
    data class PcInput(val kind: String, val value: String) : FoundationCommand
    data object StopRemote : FoundationCommand
    data object ConnectRemote : FoundationCommand
    data object StartLocation : FoundationCommand
    data object StopLocation : FoundationCommand
    data object RefreshLocation : FoundationCommand
    data object StartWake : FoundationCommand
    data object StopWake : FoundationCommand
    data object SyncAlarms : FoundationCommand
    data object SilenceAlarms : FoundationCommand
}

object FoundationPolicy {
    fun command(text: String): FoundationCommand? {
        val raw = text.trim().replace(Regex("^(?:hey\\s+)?nakama[,:]?\\s+", RegexOption.IGNORE_CASE), "")
        val value = raw.trimEnd('.', '!', '?').lowercase()
        return when {
            value.startsWith("type on pc ") -> FoundationCommand.PcInput("text", raw.substring(11).take(500))
            value in listOf("press enter on pc", "press escape on pc", "press tab on pc", "press backspace on pc") -> FoundationCommand.PcInput("key", when { value.contains("escape") -> "Escape"; value.contains("backspace") -> "Backspace"; value.contains("tab") -> "Tab"; else -> "Enter" })
            value in listOf("scroll pc up", "scroll pc down") -> FoundationCommand.PcInput("scroll", if (value.endsWith("up")) "-3" else "3")
            value in listOf("open task board", "show task board", "show my tasks", "open tasks") -> FoundationCommand.Open("Tasks")
            value in listOf("open routines", "show routines", "open routines board", "show my routines", "show my alarms") -> FoundationCommand.Open("Routines")
            value in listOf("open remote desktop", "show my pc", "open my pc screen", "show remote desktop") -> FoundationCommand.Open("Remote PC")
            value in listOf("stop remote desktop", "disconnect remote desktop", "stop pc control") -> FoundationCommand.StopRemote
            value in listOf("connect remote desktop", "connect to my pc", "start remote desktop") -> FoundationCommand.ConnectRemote
            value.startsWith("switch monitor ") -> FoundationCommand.Monitor(value.removePrefix("switch monitor ").removePrefix("to "))
            value in listOf("show my location", "open location") -> FoundationCommand.Open("Location")
            value in listOf("start location sharing", "share my location", "start location tracking") -> FoundationCommand.StartLocation
            value in listOf("stop location sharing", "stop location tracking") -> FoundationCommand.StopLocation
            value in listOf("update my location", "refresh my location") -> FoundationCommand.RefreshLocation
            value in listOf("enable wake word", "start wake word", "listen for nakama") -> FoundationCommand.StartWake
            value in listOf("disable wake word", "stop wake word", "stop listening for nakama") -> FoundationCommand.StopWake
            value in listOf("sync phone alarms", "sync my alarms") -> FoundationCommand.SyncAlarms
            value in listOf("stop alarm", "stop alarms", "silence alarms", "silence ringing alarms") -> FoundationCommand.SilenceAlarms
            else -> null
        }
    }

    /** Only a leading wake phrase grants the following utterance; incidental mentions are discarded. */
    fun wakeCommand(text: String): String? = Regex("^(?:hey\\s+)?nakama\\b[,:.!?]?\\s*(.*)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)).matchEntire(text.trim())?.groupValues?.get(1)?.trim()?.take(24_000)

    fun nextAlarm(time: String, weekdays: Set<Int>, zone: String, now: Instant): Instant? {
        if (!time.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) || weekdays.isEmpty() || weekdays.any { it !in 0..6 }) return null
        val zoneId = runCatching { ZoneId.of(zone) }.getOrNull() ?: return null
        val local = now.atZone(zoneId)
        val (hour, minute) = time.split(':').map(String::toInt)
        for (offset in 0L..7L) {
            val day = local.toLocalDate().plusDays(offset)
            val weekday = if (day.dayOfWeek == DayOfWeek.SUNDAY) 0 else day.dayOfWeek.value
            val localTime = java.time.LocalDateTime.of(day, java.time.LocalTime.of(hour, minute))
            val offsetForDay = zoneId.rules.getValidOffsets(localTime).firstOrNull() ?: continue
            val candidate = localTime.toInstant(offsetForDay)
            if (weekday in weekdays && candidate.isAfter(now)) return candidate
        }
        return null
    }

    fun validLocation(latitude: Double, longitude: Double, accuracy: Float, observedAt: Long, now: Long): Boolean =
        latitude.isFinite() && longitude.isFinite() && accuracy.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0 && accuracy in 0f..100_000f && observedAt > 0 && observedAt <= now + 60_000 && now - observedAt <= 300_000
}

/** Main-thread audio ownership shared by foreground conversation and the optional wake service. */
internal object VoiceAudioGate {
    private val owners = mutableSetOf<Any>()
    val busy get() = owners.isNotEmpty()
    fun set(owner: Any, active: Boolean) { if (active) owners += owner else owners -= owner }
}
