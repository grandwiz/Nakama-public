package dev.nakama.companion

data class TimerMoment(val wallMillis: Long, val elapsedMillis: Long, val bootCount: Int)
data class LocalTimer(
    val id: String, val title: String, val durationMillis: Long, val remainingMillis: Long,
    val status: String, val revision: Int, val createdAt: Long,
    val endsAt: Long = 0, val elapsedEnd: Long = 0, val bootCount: Int = -1, val issue: String = "",
)
interface LocalTimerStorage { fun load(): List<LocalTimer>; fun save(timers: List<LocalTimer>) }
interface LocalTimerEffects {
    fun unavailable(): String?
    fun schedule(timer: LocalTimer, remainingMillis: Long)
    fun cancel(timer: LocalTimer)
    fun notifyFinished(timer: LocalTimer)
    fun silence(timer: LocalTimer)
}
object LocalTimerPolicy {
    val active = setOf("running", "paused", "finished")
    fun remaining(timer: LocalTimer, now: TimerMoment): Long = when (timer.status) {
        "running" -> (if (timer.bootCount >= 0 && timer.bootCount == now.bootCount && now.elapsedMillis <= timer.elapsedEnd)
            timer.elapsedEnd - now.elapsedMillis else if (timer.bootCount >= 0 && timer.bootCount == now.bootCount)
            0 else timer.endsAt - now.wallMillis).coerceIn(0, timer.durationMillis)
        "paused" -> timer.remainingMillis.coerceIn(0, timer.durationMillis)
        else -> 0
    }
    fun duration(millis: Long): String {
        val seconds = ((millis.coerceAtLeast(0) + 999) / 1000)
        val hours = seconds / 3600; val minutes = seconds / 60 % 60; val rest = seconds % 60
        return listOf(hours to "hour", minutes to "minute", rest to "second").filter { it.first > 0 }
            .joinToString(" ") { (amount, unit) -> "$amount $unit${if (amount == 1L) "" else "s"}" }.ifBlank { "0 seconds" }
    }
    fun display(millis: Long): String {
        val seconds = (millis.coerceAtLeast(0) + 999) / 1000
        return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
        else "%02d:%02d".format(seconds / 60, seconds % 60)
    }
}

/** Deterministic state machine. Android effects are injected so tests cannot schedule real alarms. */
class LocalTimerEngine(
    private val storage: LocalTimerStorage,
    private val effects: LocalTimerEffects,
    private val clock: () -> TimerMoment,
    private val newId: () -> String,
) {
    fun snapshot(): List<LocalTimer> = storage.load()
    private fun save(timer: LocalTimer) {
        val all = storage.load().filterNot { it.id == timer.id } + timer
        val current = all.filter { it.status in setOf("running", "paused") }
        val finished = all.asReversed().filter { it.status == "finished" }.sortedByDescending { it.createdAt }.take(40)
        val history = all.asReversed().filterNot { it.status in LocalTimerPolicy.active }.sortedByDescending { it.createdAt }.take(40)
        val retained = current + finished + history
        all.filter { old -> old.status == "finished" && retained.none { it.id == old.id } }.forEach { runCatching { effects.silence(it) } }
        storage.save(retained.sortedBy { it.createdAt })
    }
    fun create(seconds: Long, title: String = ""): LocalTimer {
        require(seconds in 1..604_800) { "Choose a timer from one second to seven days." }
        require(storage.load().count { it.status in setOf("running", "paused") } < 24) { "There are already 24 phone timers. Cancel one before adding another." }
        require(title.length <= 80 && title.none(Char::isISOControl)) { "Use a timer name under 80 characters." }
        val now = clock()
        val timer = LocalTimer(newId(), title.trim().ifBlank { "Timer" }, seconds * 1000, seconds * 1000, "paused", 1, now.wallMillis)
        return start(timer, now)
    }
    private fun start(timer: LocalTimer, now: TimerMoment): LocalTimer {
        val unavailable = effects.unavailable()
        if (unavailable != null) {
            runCatching { effects.cancel(timer) }; runCatching { effects.silence(timer) }
            return timer.copy(status = "paused", endsAt = 0, elapsedEnd = 0, issue = unavailable).also(::save)
        }
        val running = timer.copy(status = "running", endsAt = now.wallMillis + timer.remainingMillis,
            elapsedEnd = now.elapsedMillis + timer.remainingMillis, bootCount = now.bootCount, issue = "")
        save(running)
        return try { effects.schedule(running, running.remainingMillis); running }
        catch (error: Exception) {
            runCatching { effects.cancel(running) }; runCatching { effects.silence(running) }
            running.copy(status = "paused", revision = running.revision + 1, endsAt = 0, elapsedEnd = 0,
                issue = error.message ?: "Android did not register this timer.").also(::save)
        }
    }
    fun change(id: String, expectedRevision: Int, action: String): LocalTimer {
        val timer = storage.load().firstOrNull { it.id == id } ?: error("That phone timer no longer exists.")
        check(timer.revision == expectedRevision) { "That timer changed. Review its latest state and try again." }
        val now = clock()
        val remaining = LocalTimerPolicy.remaining(timer, now)
        val next = when (action) {
            "pause" -> {
                check(timer.status == "running") { "Only a running timer can be paused." }
                if (remaining == 0L) { fire(timer.id, timer.revision); return storage.load().first { it.id == id } }
                timer.copy(status = "paused", remainingMillis = remaining, endsAt = 0, elapsedEnd = 0, revision = timer.revision + 1, issue = "")
            }
            "resume" -> {
                check(timer.status == "paused" && remaining > 0) { "Only a paused timer can be resumed." }
                return start(timer.copy(revision = timer.revision + 1), now)
            }
            "cancel", "stop" -> {
                check(timer.status in LocalTimerPolicy.active) { "This timer is already stopped." }
                timer.copy(status = if (timer.status == "finished") "dismissed" else "cancelled", revision = timer.revision + 1, remainingMillis = remaining, issue = "")
            }
            "dismiss" -> {
                check(timer.status == "finished") { "Only a finished timer can be dismissed." }
                timer.copy(status = "dismissed", revision = timer.revision + 1, issue = "")
            }
            else -> error("That timer action is unavailable.")
        }
        save(next)
        effects.cancel(timer); effects.silence(timer)
        return next
    }
    fun fire(id: String, revision: Int): Boolean {
        val timer = storage.load().firstOrNull { it.id == id && it.revision == revision && it.status == "running" } ?: return false
        if (LocalTimerPolicy.remaining(timer, clock()) > 0) return false
        val finished = timer.copy(status = "finished", remainingMillis = 0, revision = timer.revision + 1, issue = "")
        save(finished)
        try { effects.notifyFinished(finished) }
        catch (error: Exception) { save(finished.copy(issue = error.message ?: "Android could not show the timer alert.")) }
        return true
    }
    /** Re-register surviving deadlines after reboot/app upgrade; paused timers never start themselves. */
    fun restore() {
        val now = clock()
        storage.load().filter { it.status == "running" }.forEach { timer ->
            val remaining = LocalTimerPolicy.remaining(timer, now)
            if (remaining == 0L) fire(timer.id, timer.revision)
            else {
                effects.cancel(timer)
                start(timer.copy(remainingMillis = remaining, revision = timer.revision + 1), now)
            }
        }
    }
}
