package dev.nakama.companion

/** Direct owner utterances only. Never interpret provider output, saved notes or screen text. */
sealed interface NakamaNavigation {
    data class Page(val tab: String, val area: String? = null) : NakamaNavigation
    data class Android(val action: String) : NakamaNavigation
    data class App(val label: String) : NakamaNavigation
}

/** Navigation can be superseded independently of ongoing worker reply ownership. */
class NavigationReceiptGate {
    private var generation = 0L
    fun begin(): Long = ++generation
    fun invalidate() { ++generation }
    fun accepts(ticket: Long) = ticket == generation
}

object NavigationPolicy {
    private val pages = mapOf(
        "home" to NakamaNavigation.Page("Home"), "nakama home" to NakamaNavigation.Page("Home"),
        "chat" to NakamaNavigation.Page("Chat"), "conversation" to NakamaNavigation.Page("Chat"),
        "projects" to NakamaNavigation.Page("Projects"), "personal" to NakamaNavigation.Page("Personal"),
        "gmail and calendar" to NakamaNavigation.Page("Personal"), "google accounts" to NakamaNavigation.Page("Personal"),
        "usage" to NakamaNavigation.Page("Usage"), "ai usage" to NakamaNavigation.Page("Usage"),
        "device" to NakamaNavigation.Page("Device"), "devices" to NakamaNavigation.Page("Device"),
        "settings" to NakamaNavigation.Page("Device"), "nakama settings" to NakamaNavigation.Page("Device"),
        "phone control" to NakamaNavigation.Page("Device"), "mascot" to NakamaNavigation.Page("Device"),
        "tools" to NakamaNavigation.Page("Tools", "Tasks"), "tasks" to NakamaNavigation.Page("Tools", "Tasks"),
        "task board" to NakamaNavigation.Page("Tools", "Tasks"), "clipboard" to NakamaNavigation.Page("Tools", "Tasks"),
        "routines" to NakamaNavigation.Page("Tools", "Routines"), "routines board" to NakamaNavigation.Page("Tools", "Routines"),
        "alarms" to NakamaNavigation.Page("Tools", "Routines"),
        "clock" to NakamaNavigation.Page("Tools", "Clock"), "timers" to NakamaNavigation.Page("Tools", "Clock"),
        "agents" to NakamaNavigation.Page("Tools", "Agent office"), "agent office" to NakamaNavigation.Page("Tools", "Agent office"),
        "office" to NakamaNavigation.Page("Tools", "Agent office"), "team" to NakamaNavigation.Page("Tools", "Agent office"),
        "core memory" to NakamaNavigation.Page("Tools", "Core Memory"), "memory" to NakamaNavigation.Page("Tools", "Core Memory"),
        "skills" to NakamaNavigation.Page("Tools", "Skills"), "learned skills" to NakamaNavigation.Page("Tools", "Skills"),
        "github" to NakamaNavigation.Page("Projects"), "github repositories" to NakamaNavigation.Page("Projects"),
        "project files" to NakamaNavigation.Page("Projects"), "project reports" to NakamaNavigation.Page("Projects"),
        "account setup" to NakamaNavigation.Page("Tools", "Account setup"),
        "project setup" to NakamaNavigation.Page("Tools", "Project setup"), "setup questions" to NakamaNavigation.Page("Tools", "Project setup"),
        "browser" to NakamaNavigation.Page("Tools", "Browser"), "browser studio" to NakamaNavigation.Page("Tools", "Browser"),
        "monitoring" to NakamaNavigation.Page("Tools", "Monitoring"), "monitors" to NakamaNavigation.Page("Tools", "Monitoring"), "monitoring mode" to NakamaNavigation.Page("Tools", "Monitoring"),
        "dynamic upgrade" to NakamaNavigation.Page("Tools", "Dynamic upgrade"), "self maintenance" to NakamaNavigation.Page("Tools", "Dynamic upgrade"), "upgrades" to NakamaNavigation.Page("Tools", "Dynamic upgrade"),
        "remote pc" to NakamaNavigation.Page("Tools", "Remote PC"), "remote desktop" to NakamaNavigation.Page("Tools", "Remote PC"),
        "pc screen" to NakamaNavigation.Page("Tools", "Remote PC"),
        "location" to NakamaNavigation.Page("Tools", "Location"), "wake word" to NakamaNavigation.Page("Tools", "Wake word"),
        "voice settings" to NakamaNavigation.Page("Device"),
    )

    fun parse(input: String): NakamaNavigation? {
        val raw = input.trim().replace(Regex("^(?:hey\\s+)?nakama[,:]?\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^please\\s+", RegexOption.IGNORE_CASE), "").trimEnd('.', '!', '?').trim()
        val text = raw.lowercase()
        val action = when (text) {
            "android home", "go to android home", "phone home", "go to phone home", "go to my phone home screen" -> "home"
            "android back", "go back on android", "go back on my phone", "phone back" -> "back"
            "android recents", "show recent apps", "show android recents", "open recent apps", "phone recents" -> "recents"
            "android notifications", "show android notifications", "show phone notifications", "open notification shade" -> "notifications"
            "android settings", "open android settings", "phone settings", "open phone settings" -> "settings"
            else -> null
        }
        if (action != null) return NakamaNavigation.Android(action)
        Regex("^(?:open|show|go to|take me to)(?: the| my)?\\s+(.+)$").matchEntire(text)?.let {
            pages[it.groupValues[1]]?.let { page -> return page }
        }
        AppLaunchPolicy.parse(input)?.takeIf { it.packageName == null }?.let {
            return NakamaNavigation.App(it.label)
        }
        return null
    }

    /** A single direct response may request navigation. Historical messages must never call this. */
    fun hostTarget(target: String): NakamaNavigation.Page? = when (target) {
        "home" -> pages["home"]; "chat", "assistant" -> pages["chat"]; "projects" -> pages["projects"]
        "tasks", "boards", "task-board", "taskBoard" -> pages["tasks"]; "routines" -> pages["routines"]
        "clock", "timers" -> pages["clock"]
        "agents", "agent-office", "agentOffice" -> pages["agents"]
        "core-memory", "coreMemory", "memory" -> pages["memory"]
        "skills" -> pages["skills"]; "github" -> pages["github"]
        "browser", "browser-studio" -> pages["browser"]
        "monitoring", "monitors" -> pages["monitoring"]
        "self-maintenance", "dynamic-upgrade", "upgrades" -> pages["dynamic upgrade"]
        "project-setup", "project-intakes" -> pages["project setup"]
        "remote-desktop", "remoteDesktop", "remote-pc" -> pages["remote pc"]
        "location" -> pages["location"]; "wake-word", "wakeWord" -> pages["wake word"]
        "settings", "devices", "device" -> pages["device"]; "usage" -> pages["usage"]
        "personal", "gmail", "calendar" -> pages["personal"]
        else -> null
    }

    fun matchingApps(requested: String, apps: List<Pair<String, String>>): List<Pair<String, String>> =
        apps.filter { (label, pkg) -> label.equals(requested, true) || pkg == requested }
            .distinctBy { it.second }.sortedBy { it.first }
}
