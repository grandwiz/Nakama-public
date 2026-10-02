package dev.nakama.companion

import org.json.JSONObject

data class ProjectCheckDefinition(
    val name: String,
    val script: String,
    val preScript: String?,
    val postScript: String?,
    val truncated: Boolean,
)

data class ProjectCheckCatalogue(
    val supported: Boolean,
    val detail: String,
    val runtimeAvailable: Boolean,
    val runtimeDetail: String,
    val manifestHash: String?,
    val checks: List<ProjectCheckDefinition>,
    val active: Boolean,
)

data class ProjectCheckTask(
    val id: String,
    val projectId: String,
    val name: String,
    val title: String,
    val status: String,
    val output: String,
    val error: String,
    val exitCode: Int?,
    val signal: String?,
    val updatedAt: String,
    val outputTruncated: Boolean,
)

data class ProjectCheckApproval(val id: String, val status: String, val error: String, val taskId: String?)
data class ProjectChecksAccess(val paired: Boolean, val projectAllowed: Boolean, val historyAllowed: Boolean)
data class ProjectCheckScope(
    val identity: HostIdentity?,
    val projectId: String,
    val projectAllowed: Boolean,
    val historyAllowed: Boolean,
    val connected: Boolean,
)
data class ProjectCheckTicket(val scope: ProjectCheckScope, val generation: Long)

/** Blocking HTTPS can finish after coroutine cancellation. Only this scope's newest reply may update UI. */
class ProjectChecksRequestGate {
    private var scope: ProjectCheckScope? = null
    private var generation = 0L
    private var inFlight = false

    fun update(next: ProjectCheckScope) {
        if (scope != next) {
            invalidate()
            scope = next
        }
    }

    fun begin(): ProjectCheckTicket? {
        val current = scope ?: return null
        if (inFlight || current.identity == null || !current.connected || !current.projectAllowed || current.projectId.isBlank()) return null
        inFlight = true
        generation++
        return ProjectCheckTicket(current, generation)
    }

    fun accepts(ticket: ProjectCheckTicket): Boolean = inFlight && ticket.generation == generation && ticket.scope == scope

    fun finish(ticket: ProjectCheckTicket): Boolean {
        if (!accepts(ticket)) return false
        inFlight = false
        return true
    }

    fun invalidate() {
        generation++
        inFlight = false
    }
}

object ProjectChecksModels {
    private val names = setOf("test", "lint", "typecheck", "check", "build")
    private const val SCRIPT_LIMIT = 6000
    private const val OUTPUT_LIMIT = 8000
    private val ansi = Regex("\\u001B\\[[0-?]*[ -/]*[@-~]")
    private val controls = Regex("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]")

    fun isKnownCheck(name: String): Boolean = name in names
    fun isValidManifestHash(hash: String): Boolean = hash.matches(Regex("[a-f0-9]{64}"))
    private fun plain(value: String): String = controls.replace(ansi.replace(value.replace("\r\n", "\n").replace('\r', '\n'), ""), "")
    private fun head(value: String, limit: Int): String {
        var end = minOf(value.length, limit)
        if (end > 0 && end < value.length && value[end - 1].isHighSurrogate() && value[end].isLowSurrogate()) end--
        return value.substring(0, end)
    }
    private fun tail(value: String, limit: Int): String {
        var start = maxOf(0, value.length - limit)
        if (start > 0 && start < value.length && value[start - 1].isHighSurrogate() && value[start].isLowSurrogate()) start++
        return value.substring(start)
    }
    private fun text(json: JSONObject, key: String, limit: Int): String = head(plain((json.opt(key) as? String).orEmpty()), limit)

    fun catalogue(json: JSONObject): ProjectCheckCatalogue {
        val checks = json.objects("checks").mapNotNull { item ->
            val name = item.opt("name") as? String ?: return@mapNotNull null
            val script = item.opt("script") as? String ?: return@mapNotNull null
            if (!isKnownCheck(name) || script.isBlank()) return@mapNotNull null
            val pre = item.opt("preScript") as? String
            val post = item.opt("postScript") as? String
            ProjectCheckDefinition(name, head(plain(script), SCRIPT_LIMIT), pre?.let { head(plain(it), SCRIPT_LIMIT) }, post?.let { head(plain(it), SCRIPT_LIMIT) },
                script.length > SCRIPT_LIMIT || (pre?.length ?: 0) > SCRIPT_LIMIT || (post?.length ?: 0) > SCRIPT_LIMIT)
        }.distinctBy { it.name }.take(5)
        val runtime = json.optJSONObject("runtime")
        return ProjectCheckCatalogue(
            supported = json.opt("supported") == true && checks.isNotEmpty(),
            detail = text(json, "detail", 1600),
            runtimeAvailable = runtime?.opt("available") == true,
            runtimeDetail = runtime?.let { text(it, "detail", 1600) }.orEmpty(),
            manifestHash = (json.opt("manifestHash") as? String)?.takeIf(::isValidManifestHash),
            checks = checks,
            active = json.opt("active") == true,
        )
    }

    fun requestBody(catalogue: ProjectCheckCatalogue, name: String): JSONObject {
        require(catalogue.supported && catalogue.runtimeAvailable && !catalogue.active) { "Refresh checks and wait for any current run to finish." }
        require(isKnownCheck(name) && catalogue.checks.any { it.name == name }) { "Choose a listed project check." }
        require(catalogue.manifestHash?.let(::isValidManifestHash) == true) { "Refresh checks to read the current package.json." }
        return JSONObject().put("name", name).put("manifestHash", catalogue.manifestHash)
    }

    fun access(state: JSONObject, deviceId: String?): ProjectChecksAccess {
        val paired = !deviceId.isNullOrBlank()
        val device = state.objects("devices").find { it.optString("id") == deviceId }
        val permissions = device?.optJSONObject("permissions")
        val projects = paired && device != null && permissions?.opt("projectAccess") != false
        return ProjectChecksAccess(paired, projects, projects && permissions?.opt("googleAccess") != false)
    }

    fun tasks(state: JSONObject, projectId: String, historyAllowed: Boolean): List<ProjectCheckTask> {
        if (!historyAllowed || projectId.isBlank()) return emptyList()
        return state.objects("tasks")
            .filter { it.optString("projectId") == projectId && it.optString("kind") == "project_check" && isKnownCheck(it.optString("checkName")) }
            .sortedByDescending { it.optString("updatedAt").ifBlank { it.optString("createdAt") } }
            .take(20)
            .mapNotNull { task ->
                val id = text(task, "id", 200).takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val output = plain((task.opt("output") as? String).orEmpty())
                val number = task.opt("exitCode") as? Number
                val exitCode = number?.toDouble()?.takeIf { it.isFinite() && it >= Int.MIN_VALUE && it <= Int.MAX_VALUE && it == it.toInt().toDouble() }?.toInt()
                ProjectCheckTask(id, projectId, task.optString("checkName"), text(task, "title", 240).ifBlank { "npm run ${task.optString("checkName")}" },
                    text(task, "status", 40).ifBlank { "unknown" }, tail(output, OUTPUT_LIMIT), text(task, "error", 2000), exitCode,
                    text(task, "signal", 100).takeIf { it.isNotBlank() }, text(task, "updatedAt", 100).ifBlank { text(task, "createdAt", 100) }, output.length > OUTPUT_LIMIT)
            }
    }

    fun approval(json: JSONObject): ProjectCheckApproval? {
        if (json.optString("type") != "project_check") return null
        val id = text(json, "id", 200).takeIf { it.isNotBlank() } ?: return null
        return ProjectCheckApproval(id, text(json, "status", 40).ifBlank { "unknown" }, text(json, "error", 2000),
            json.optJSONObject("result")?.let { text(it, "taskId", 200).takeIf(String::isNotBlank) })
    }
}
