package dev.nakama.companion

import org.json.JSONArray
import org.json.JSONObject

object ChatRequest {
    fun body(message: String, project: String, automatic: Boolean, provider: String, model: String,
             effort: String, mode: String, team: List<String>): JSONObject {
        val body = JSONObject().put("message", message)
        if (project.isNotBlank()) body.put("projectId", project)
        if (automatic) return body.put("routing", "auto")
        body.put("providerId", provider).put("effort", effort)
            .put("mode", when { mode == "Do a task" -> "act"; project.isNotBlank() && mode == "Build project files" -> "build"; else -> "discuss" })
        if (team.isNotEmpty()) body.put("team", JSONArray(team))
        else if (model.isNotBlank()) body.put("model", model)
        return body
    }
}
