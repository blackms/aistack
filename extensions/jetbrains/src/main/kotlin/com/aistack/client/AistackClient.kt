package com.aistack.client

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Minimal REST client for the aistack daemon. Mirrors the VS Code extension's
 * surface: list/spawn/stop agents, list memory entries, list/start review loops.
 *
 * Uses OkHttp + kotlinx.serialization. Single retry on 5xx / network failure.
 * The daemon is local so we keep timeouts tight.
 */
class AistackClient(
    private val baseUrl: String,
    private val token: String?,
    private val timeoutMs: Long
) {
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .build()

    private val json: Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    private val jsonMedia = "application/json".toMediaType()

    // ---------- data classes ----------

    @Serializable
    data class AgentSummary(
        val id: String,
        val type: String,
        val name: String? = null,
        val status: String,
        val sessionId: String? = null,
        val createdAt: String? = null
    )

    @Serializable
    data class AgentTypeDef(
        val type: String,
        val name: String,
        val description: String,
        val capabilities: List<String> = emptyList()
    )

    @Serializable
    data class SpawnAgentRequest(
        val type: String,
        val name: String? = null,
        val sessionId: String? = null
    )

    @Serializable
    data class ExecuteAgentRequest(val task: String)

    @Serializable
    data class ExecuteAgentResponse(
        val response: String,
        val model: String? = null,
        val duration: Long? = null
    )

    @Serializable
    data class ReviewLoopSummary(
        val id: String,
        val coderId: String,
        val adversarialId: String,
        val iteration: Int,
        val maxIterations: Int,
        val status: String,
        val startedAt: String? = null,
        val completedAt: String? = null,
        val reviewCount: Int = 0
    )

    @Serializable
    data class StartReviewLoopRequest(
        val codeInput: String,
        val maxIterations: Int? = null
    )

    // ---------- agents ----------

    fun listAgents(): List<AgentSummary> =
        getJson("/api/v1/agents", kotlinx.serialization.builtins.ListSerializer(AgentSummary.serializer()))

    fun listAgentTypes(): List<AgentTypeDef> =
        getJson(
            "/api/v1/agents/types",
            kotlinx.serialization.builtins.ListSerializer(AgentTypeDef.serializer())
        )

    fun spawnAgent(req: SpawnAgentRequest): AgentSummary =
        postJson("/api/v1/agents", req, SpawnAgentRequest.serializer(), AgentSummary.serializer())

    fun stopAgent(id: String) {
        val request = baseRequest("/api/v1/agents/${encode(id)}").delete().build()
        execute(request).close()
    }

    fun executeAgent(id: String, task: String): ExecuteAgentResponse =
        postJson(
            "/api/v1/agents/${encode(id)}/execute",
            ExecuteAgentRequest(task),
            ExecuteAgentRequest.serializer(),
            ExecuteAgentResponse.serializer()
        )

    // ---------- review loops ----------

    fun listReviewLoops(): List<ReviewLoopSummary> =
        getJson(
            "/api/v1/review-loops",
            kotlinx.serialization.builtins.ListSerializer(ReviewLoopSummary.serializer())
        )

    fun startReviewLoop(req: StartReviewLoopRequest): ReviewLoopSummary =
        postJson(
            "/api/v1/review-loops",
            req,
            StartReviewLoopRequest.serializer(),
            ReviewLoopSummary.serializer()
        )

    // ---------- internals ----------

    private fun <T> getJson(path: String, deserializer: kotlinx.serialization.KSerializer<T>): T {
        val req = baseRequest(path).get().build()
        val body = execute(req).use { it.body?.string().orEmpty() }
        return json.decodeFromString(deserializer, body)
    }

    private fun <Req, Resp> postJson(
        path: String,
        body: Req,
        reqSer: kotlinx.serialization.KSerializer<Req>,
        respSer: kotlinx.serialization.KSerializer<Resp>
    ): Resp {
        val payload = json.encodeToString(reqSer, body).toRequestBody(jsonMedia)
        val request = baseRequest(path).post(payload).build()
        val responseBody = execute(request).use { it.body?.string().orEmpty() }
        return json.decodeFromString(respSer, responseBody)
    }

    private fun baseRequest(path: String): Request.Builder {
        val b = Request.Builder().url(baseUrl.trimEnd('/') + path).header("Accept", "application/json")
        if (!token.isNullOrBlank()) b.header("Authorization", "Bearer $token")
        return b
    }

    private fun execute(request: Request, attempt: Int = 0): okhttp3.Response {
        val resp: okhttp3.Response = try {
            http.newCall(request).execute()
        } catch (e: IOException) {
            if (attempt == 0) {
                Thread.sleep(500)
                return execute(request, attempt + 1)
            }
            throw AistackException(
                -1,
                "aistack daemon unreachable at $baseUrl: ${e.message}"
            )
        }
        if (!resp.isSuccessful) {
            val status = resp.code
            val text = resp.body?.string().orEmpty()
            resp.close()
            if (status >= 500 && attempt == 0) {
                Thread.sleep(500)
                return execute(request, attempt + 1)
            }
            throw AistackException(status, "${request.method} ${request.url.encodedPath} failed: $status $text")
        }
        return resp
    }

    private fun encode(s: String): String =
        java.net.URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")
}

class AistackException(val status: Int, message: String) : RuntimeException(message)
