package dev.nakama.companion

import org.json.JSONObject
import java.util.Locale

data class DeviceTarget(val id: String, val name: String, val platform: String, val connected: Boolean)
data class DirectedDeviceCommand(val originalCommand: String, val targetName: String, val command: String, val appName: String = "", val timer: LocalClockCommand.CreateTimer? = null, val error: String = "")

/** A record may be visible in shared history without being addressed to this device. */
object DeviceDelivery {
    fun addressedTo(deliveryDeviceId: String, deviceId: String) = deviceId.isNotBlank() && deliveryDeviceId == deviceId
    fun addressedTo(record: JSONObject, deviceId: String) = addressedTo(record.optString("deliveryDeviceId"), deviceId)
    fun executesHere(action: JSONObject, deviceId: String) = deviceId.isNotBlank() && action.optString("deviceId") == deviceId
    fun alarmReceipt(routine: JSONObject, deviceId: String): JSONObject? {
        if (deviceId !in alarmTargets(routine)) return null
        val receipt = routine.optJSONObject("deviceSchedules")?.optJSONObject(deviceId)
            ?: routine.optJSONObject("deviceSchedule")?.takeIf { it.optString("deviceId") == deviceId } ?: return null
        return receipt.takeIf { routine.optString("updatedAt").isNotBlank() && it.optString("expectedUpdatedAt") == routine.optString("updatedAt") }
    }
    fun alarmTargets(routine: JSONObject): Set<String> {
        val targets = routine.optJSONArray("targetDeviceIds")
        return if (targets != null) (0 until targets.length()).map { targets.optString(it) }.filter { it.isNotBlank() }.toSet()
        else setOf(routine.optString("targetDeviceId")).filter { it.isNotBlank() && it != "null" }.toSet()
    }
}

/** Only an explicit suffix redirects execution. No guessed device and no fallback on resolution failure. */
object DeviceCommandRouting {
    fun parse(input: String): DirectedDeviceCommand? {
        if (input.length > 500) return null
        val normalized = input.trim().replace(Regex("^(?:hey\\s+)?nakama[,:.!?]?\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^please\\s+", RegexOption.IGNORE_CASE), "").trimEnd('.', '!', '?')
            .replace(Regex("\\s+please$", RegexOption.IGNORE_CASE), "")
        val match = Regex("^(.+) on (.+)$", RegexOption.IGNORE_CASE).matchEntire(normalized) ?: return null
        val command = match.groupValues[1].trim()
        val target = match.groupValues[2].trim()
        val timer = LocalClockCommands.parse(command)
        if (timer is LocalClockCommand.CreateTimer) return DirectedDeviceCommand(command, target, "timer", timer = timer)
        if (Regex("^(?:set|start|create|pause|resume|stop|cancel|dismiss)\\b.*\\btimer\\b", RegexOption.IGNORE_CASE).containsMatchIn(command))
            return DirectedDeviceCommand(command, target, "", error = "Use a complete timer duration and one named connected device. Other-device timer controls are available on that device.")
        val app = Regex("^(?:open|launch|start) (.+)$", RegexOption.IGNORE_CASE).matchEntire(command)?.groupValues?.get(1) ?: return null
        if (app.length !in 1..120 || target.length !in 1..80 || listOf(app, target).any { it.any(Char::isISOControl) || Regex("\\b(?:and then|then|and (?:open|start|set|send|call|delete)|don't|do not)\\b", RegexOption.IGNORE_CASE).containsMatchIn(it) })
            return DirectedDeviceCommand(command, target, "", error = "Name one app and one connected device in a single request.")
        return DirectedDeviceCommand(command, target, "open_app", appName = app)
    }
    fun isThisDevice(name: String) = name.lowercase(Locale.ROOT) in setOf("this phone", "this tablet", "this device")
    fun targets(response: JSONObject) = response.objects("devices").take(100).map {
        DeviceTarget(it.optString("id"), it.optString("name"), it.optString("platform"), it.optBoolean("connected"))
    }
    fun resolve(name: String, targets: List<DeviceTarget>): DeviceTarget {
        val matching = if (name.trim().lowercase(Locale.ROOT) in setOf("pc", "desktop", "this pc")) targets.filter { it.id == "desktop" } else targets.filter { it.name.equals(name.trim(), true) }
        require(matching.size == 1) { if (matching.isEmpty()) "No connected device is named '$name'. Check its exact name in Devices." else "More than one device is named '$name'. Give the devices distinct names before redirecting a command." }
        return matching.single().also { require(it.connected) { "${it.name} is offline. Nothing was sent to another device." } }
    }
    fun body(command: DirectedDeviceCommand, target: DeviceTarget, requestId: String): JSONObject {
        require(command.error.isBlank() && command.command in setOf("open_app", "timer"))
        val args = if (command.command == "open_app") JSONObject().put("appName", command.appName)
            else JSONObject().put("durationSeconds", command.timer!!.seconds).put("title", command.timer.title).put("requestId", requestId)
        return JSONObject().put("command", command.command).put("targetDeviceId", target.id).put("targetDeviceName", target.name).put("args", args).put("requestId", requestId)
    }
}
