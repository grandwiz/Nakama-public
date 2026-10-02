package dev.nakama.companion

import java.time.OffsetDateTime

/** Validate explicit user-composed operations before any network request. */
object GoogleForms {
    fun email(to: String, subject: String, body: String) {
        require(to.matches(Regex("[^\\s<>@,;]+@[^\\s<>@,;]+\\.[^\\s<>@,;]+"))) { "Enter one complete email address, without a display name." }
        require(subject.isNotBlank() && subject.length <= 500 && !subject.contains('\r') && !subject.contains('\n')) { "Enter a subject on one line, up to 500 characters." }
        require(body.isNotBlank() && body.length <= 100_000) { "Enter your message, up to 100,000 characters." }
    }
    fun event(summary: String, start: String, end: String) {
        require(summary.isNotBlank() && summary.length <= 500) { "Enter an event title, up to 500 characters." }
        val from = try { OffsetDateTime.parse(start) } catch (_: Exception) { throw IllegalArgumentException("Start needs a date, time and timezone, for example 2026-09-30T14:00:00+01:00.") }
        val until = try { OffsetDateTime.parse(end) } catch (_: Exception) { throw IllegalArgumentException("End needs a date, time and timezone.") }
        require(until.toInstant().isAfter(from.toInstant())) { "The event must end after it starts." }
    }
}
