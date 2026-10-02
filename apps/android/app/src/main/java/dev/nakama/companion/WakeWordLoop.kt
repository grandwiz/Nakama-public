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
    private var commandUntil = 0L
    var enabled = false; private set
    fun start() { stop(); enabled = true; nextAttempt = now(); onStatus("Enabled · waiting for local microphone") }
    fun stop() { enabled = false; generation++; runCatching { recognition?.close() }; recognition = null; commandUntil = 0; onStatus("Off") }
    fun tick(audioBusy: Boolean) {
        if (!enabled) return
        if (audioBusy) {
            if (recognition != null) { generation++; runCatching { recognition?.close() }; recognition = null }
            commandUntil = 0; nextAttempt = now() + 700; onStatus("Paused · conversation or spoken reply"); return
        }
        if (commandUntil != 0L && now() > commandUntil) commandUntil = 0
        if (recognition != null) {
            if (now() - startedAt > 25_000) { generation++; runCatching { recognition?.close() }; recognition = null; nextAttempt = now() + 1000 }
            return
        }
        if (now() < nextAttempt) return
        val token = ++generation
        startedAt = now()
        try {
            recognition = create({ text ->
                if (enabled && token == generation) {
                    generation++; runCatching { recognition?.close() }; recognition = null
                    val command = if (commandUntil > now()) text.trim().take(24_000) else FoundationPolicy.wakeCommand(text)
                    if (command != null && command.isBlank()) { commandUntil = now() + 15_000; nextAttempt = now() + 300; onStatus("Nakama heard · say your command") }
                    else if (!command.isNullOrBlank()) { commandUntil = 0; nextAttempt = now() + 5000; onStatus("Command heard · opening Nakama"); onCommand(command) }
                    else { nextAttempt = now() + 700; onStatus("Listening locally for Nakama") }
                }
            }, { error ->
                if (enabled && token == generation) {
                    generation++; runCatching { recognition?.close() }; recognition = null
                    if (error in setOf(6, 7)) { nextAttempt = now() + 1000; onStatus("Listening locally for Nakama") }
                    else { enabled = false; commandUntil = 0; onStatus("Paused · local recognizer error $error. Tap Enable to retry.") }
                }
            })
            onStatus(if (commandUntil > now()) "Nakama heard · say your command" else "Listening locally for Nakama")
            recognition?.start()
        } catch (_: Exception) { enabled = false; generation++; runCatching { recognition?.close() }; recognition = null; onStatus("Unavailable · install on-device British English recognition") }
    }
}
