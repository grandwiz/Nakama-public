package dev.nakama.companion

/** Local-only recognition lifecycle, isolated so tests never capture audio. Call tick on the main thread. */
internal class WakeWordLoop(
    private val now: () -> Long,
    private val create: (onResult: (String) -> Unit, onError: (Int) -> Unit) -> VoiceRecognition,
    private val onStatus: (String) -> Unit,
    private val onCommand: (String) -> Unit,
) {
    private var generation = 0L
    private var recognition: VoiceRecognition? = null
    private var nextAttempt = 0L
    private var startedAt = 0L
    private var readyAt: Long? = null
    private var endedAt: Long? = null
    private var finishing = false
    private var commandUntil = 0L
    private var transientFailures = 0
    private var stalledStarts = 0
    var enabled = false; private set
    fun start() { stop(); transientFailures = 0; stalledStarts = 0; enabled = true; nextAttempt = now(); onStatus("Starting local microphone - preparing bundled speech") }
    private fun release() { generation++; runCatching { recognition?.close() }; recognition = null; readyAt = null; endedAt = null; finishing = false }
    fun stop() { enabled = false; release(); commandUntil = 0; onStatus("Off") }
    fun tick(audioBusy: Boolean) {
        if (!enabled) return
        if (audioBusy) {
            if (recognition != null) release()
            commandUntil = 0; nextAttempt = now() + 400; onStatus("Paused - another voice session is using audio"); return
        }
        if (commandUntil != 0L && now() > commandUntil) commandUntil = 0
        if (recognition != null) {
            if (readyAt == null && now() - startedAt >= (recognition?.startupTimeoutMillis ?: 8_000L).coerceIn(8_000L, 60_000L)) {
                release(); stalledStarts++
                if (stalledStarts >= 3) { enabled = false; commandUntil = 0; onStatus("Paused - the recognizer never reported microphone ready. Check free storage and the microphone privacy switch, then restart Nakama.") }
                else { nextAttempt = now() + 300; onStatus("Restarting a stalled local microphone - attempt ${stalledStarts + 1} of 3") }
            } else if (endedAt != null && now() - endedAt!! >= 6_000) {
                val continuous = recognition?.continuousSession == true
                release(); commandUntil = 0; nextAttempt = now() + 300
                if (continuous) { enabled = false; onStatus("Paused - no continuous recognition result arrived. Use Talk or restart Nakama; no repeated restart sounds will be generated.") }
                else onStatus("No final recognition result arrived. Listening will restart; repeat your wake request.")
            } else if (recognition?.continuousSession != true && readyAt != null && now() - readyAt!! >= 25_000 && !finishing) {
                finishing = true; endedAt = now(); runCatching { recognition?.stopListening() }
                onStatus("Finishing the local recognition session")
            }
            return
        }
        if (now() < nextAttempt) return
        val token = ++generation
        startedAt = now(); readyAt = null; endedAt = null; finishing = false
        fun current() = enabled && token == generation
        try {
            recognition = create({ text ->
                if (current()) {
                    val continuous = recognition?.continuousSession == true
                    if (!continuous) release() else { endedAt = null; finishing = false }
                    transientFailures = 0
                    val command = if (commandUntil > now()) FoundationPolicy.wakeCommand(text) ?: text.trim().take(24_000) else FoundationPolicy.wakeCommand(text)
                    if (command != null && command.isBlank()) { commandUntil = now() + 15_000; nextAttempt = now() + 100; onStatus("Nakama heard - say your command") }
                    else if (!command.isNullOrBlank()) { if (continuous) release(); commandUntil = 0; nextAttempt = now() + 250; onStatus("Command heard - asking Nakama"); onCommand(command) }
                    else { nextAttempt = now() + 200; onStatus(if (continuous) "Microphone ready - continuous local wake listening" else "Waiting for the next local microphone session") }
                }
            }, { error ->
                if (current()) {
                    val continuous = recognition?.continuousSession == true
                    release()
                    if (continuous && error in setOf(-100, 6, 7)) { enabled = false; commandUntil = 0; onStatus("Paused - ${LocalRecognitionPolicy.error(-100)}") }
                    else if (error in setOf(6, 7)) { transientFailures = 0; nextAttempt = now() + 200; onStatus("No wake phrase heard - restarting local listening") }
                    else if (error in setOf(8, 10) && ++transientFailures <= 3) { nextAttempt = now() + if (error == 10) 30_000 else 500L * transientFailures; onStatus("Waiting for the local recognizer - retry $transientFailures of 3") }
                    else { enabled = false; commandUntil = 0; onStatus("Paused - ${LocalRecognitionPolicy.error(error)}") }
                }
            })
            recognition?.observe(
                { if (current()) { readyAt = now(); stalledStarts = 0; onStatus(if (commandUntil > now()) "Microphone ready - say your command" else "Microphone ready - say Hey Nakama and your request") } },
                { if (current()) { endedAt = now(); onStatus("Speech ended - waiting for the local final result") } },
                { text -> if (current() && FoundationPolicy.wakeCommand(text) != null) onStatus("Wake phrase heard - finish your request") },
            )
            onStatus("Starting local microphone - preparing bundled speech")
            recognition?.start()
        } catch (_: Exception) { enabled = false; release(); commandUntil = 0; onStatus("Unavailable - bundled speech could not start. Restart Nakama and check free storage. No automatic service fallback was used.") }
    }
}
