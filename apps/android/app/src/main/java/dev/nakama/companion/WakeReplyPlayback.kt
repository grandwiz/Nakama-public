package dev.nakama.companion

import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** Run on the main dispatcher, like every VoiceController entry point. */
internal suspend fun awaitWakeReply(
    output: VoiceController,
    current: () -> Boolean,
    timeoutMillis: Long = 180_000,
) {
    try {
        withTimeoutOrNull(timeoutMillis) {
            while (!output.replyPlaybackAvailable && current()) delay(100)
        }
    } finally {
        // Android engines may omit their completion callback. Cancellation, session
        // changes and the deadline must still release this controller's audio gate.
        if (!output.replyPlaybackAvailable) output.stop()
    }
}
