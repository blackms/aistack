package com.aistack.settings

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.Configurable
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JPasswordField
import javax.swing.JTextField
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets

/** Plugin-wide constants. */
object AistackPlugin {
    const val ID: String = "com.aistack.intellij"
    const val DISPLAY_NAME: String = "aistack"
    const val DEFAULT_DAEMON_URL: String = "http://localhost:3001"
    const val DEFAULT_REQUEST_TIMEOUT_MS: Long = 15_000L
    const val DEFAULT_REFRESH_INTERVAL_MS: Long = 5_000L
    const val DEFAULT_AGENT_TYPE: String = "coder"
    const val ENV_API_TOKEN: String = "AISTACK_API_TOKEN"
    const val CREDENTIAL_KEY: String = "apiToken"
}

/**
 * Persisted settings for the aistack plugin.
 *
 * Non-sensitive settings live in `aistack.xml`. The API token is **never**
 * persisted to that file — it is stored in the platform's PasswordSafe
 * (OS keychain / KeePass), and the env var `AISTACK_API_TOKEN` still wins
 * over the stored value at read time.
 */
@Service(Service.Level.APP)
@State(name = "AistackSettings", storages = [Storage("aistack.xml")])
class AistackSettings : PersistentStateComponent<AistackSettings.State> {

    data class State(
        var daemonUrl: String = AistackPlugin.DEFAULT_DAEMON_URL,
        var refreshIntervalMs: Long = AistackPlugin.DEFAULT_REFRESH_INTERVAL_MS,
        var requestTimeoutMs: Long = AistackPlugin.DEFAULT_REQUEST_TIMEOUT_MS,
        var defaultAgentType: String = AistackPlugin.DEFAULT_AGENT_TYPE
    )

    private var state: State = State()

    override fun getState(): State = state
    override fun loadState(s: State) {
        state = s
    }

    private fun credentialAttributes(): CredentialAttributes =
        CredentialAttributes(generateServiceName("aistack", AistackPlugin.CREDENTIAL_KEY))

    /** Returns the stored token from PasswordSafe (no env-var fallback). */
    fun storedToken(): String? =
        PasswordSafe.instance.getPassword(credentialAttributes())?.takeIf { it.isNotBlank() }

    fun setStoredToken(token: String?) {
        val attrs = credentialAttributes()
        if (token.isNullOrBlank()) {
            PasswordSafe.instance.set(attrs, null)
        } else {
            PasswordSafe.instance.set(attrs, Credentials(AistackPlugin.CREDENTIAL_KEY, token))
        }
    }

    /** Returns the effective token: env var wins, else the value stored in PasswordSafe. */
    fun effectiveToken(): String? {
        val env = System.getenv(AistackPlugin.ENV_API_TOKEN)
        if (!env.isNullOrBlank()) return env
        return storedToken()
    }

    companion object {
        fun instance(): AistackSettings =
            ApplicationManager.getApplication().getService(AistackSettings::class.java)
    }
}

class AistackSettingsConfigurable : Configurable {
    private var panel: JPanel? = null
    private val urlField = JTextField(30)
    private val tokenField = JPasswordField(30)
    private val refreshField = JTextField(10)
    private val timeoutField = JTextField(10)
    private val agentTypeField = JTextField(20)

    override fun getDisplayName(): String = "aistack"

    override fun createComponent(): JComponent {
        val settings = AistackSettings.instance()
        val s = settings.state
        urlField.text = s.daemonUrl
        tokenField.text = settings.storedToken().orEmpty()
        refreshField.text = s.refreshIntervalMs.toString()
        timeoutField.text = s.requestTimeoutMs.toString()
        agentTypeField.text = s.defaultAgentType

        val p = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(4, 4, 4, 4)
            anchor = GridBagConstraints.WEST
        }
        fun row(y: Int, label: String, field: JComponent) {
            gbc.gridx = 0; gbc.gridy = y
            p.add(JLabel(label), gbc)
            gbc.gridx = 1
            p.add(field, gbc)
        }
        row(0, "Daemon URL:", urlField)
        row(1, "API token (stored in OS keychain; AISTACK_API_TOKEN env wins):", tokenField)
        row(2, "Refresh interval (ms):", refreshField)
        row(3, "Request timeout (ms):", timeoutField)
        row(4, "Default agent type:", agentTypeField)
        panel = p
        return p
    }

    private fun currentTokenText(): String = String(tokenField.password)

    override fun isModified(): Boolean {
        val settings = AistackSettings.instance()
        val s = settings.state
        return urlField.text != s.daemonUrl ||
            currentTokenText() != settings.storedToken().orEmpty() ||
            refreshField.text != s.refreshIntervalMs.toString() ||
            timeoutField.text != s.requestTimeoutMs.toString() ||
            agentTypeField.text != s.defaultAgentType
    }

    override fun apply() {
        val settings = AistackSettings.instance()
        val s = settings.state
        s.daemonUrl = urlField.text.trim().ifBlank { AistackPlugin.DEFAULT_DAEMON_URL }
        s.refreshIntervalMs = refreshField.text.trim().toLongOrNull()?.coerceAtLeast(1000)
            ?: AistackPlugin.DEFAULT_REFRESH_INTERVAL_MS
        s.requestTimeoutMs = timeoutField.text.trim().toLongOrNull()?.coerceAtLeast(1000)
            ?: AistackPlugin.DEFAULT_REQUEST_TIMEOUT_MS
        s.defaultAgentType = agentTypeField.text.trim().ifBlank { AistackPlugin.DEFAULT_AGENT_TYPE }
        settings.setStoredToken(currentTokenText().trim())
    }

    override fun reset() {
        val settings = AistackSettings.instance()
        val s = settings.state
        urlField.text = s.daemonUrl
        tokenField.text = settings.storedToken().orEmpty()
        refreshField.text = s.refreshIntervalMs.toString()
        timeoutField.text = s.requestTimeoutMs.toString()
        agentTypeField.text = s.defaultAgentType
    }

    override fun disposeUIResources() {
        panel = null
    }
}
