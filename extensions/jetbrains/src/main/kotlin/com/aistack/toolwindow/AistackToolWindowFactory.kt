package com.aistack.toolwindow

import com.aistack.client.AistackClient
import com.aistack.settings.AistackSettings
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities

/**
 * Tool window factory. Renders a list of agents grouped by status, with a
 * "Refresh" button. Auto-refreshes on the configured interval.
 */
class AistackToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = AistackToolWindowPanel()
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
        panel.start()
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}

private class AistackToolWindowPanel : JPanel(BorderLayout()) {
    private val listModel = DefaultListModel<String>()
    private val list = JList(listModel).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
    }
    private val status = JBLabel("aistack — loading...")
    private val refreshBtn = JButton("Refresh")
    private val stopBtn = JButton("Stop selected")
    private val executor: ScheduledExecutorService = ScheduledThreadPoolExecutor(1).apply {
        removeOnCancelPolicy = true
    }
    private val agentIds = mutableListOf<String>()

    init {
        val top = JPanel(FlowLayout(FlowLayout.LEFT)).apply {
            add(status)
            add(refreshBtn)
            add(stopBtn)
        }
        add(top, BorderLayout.NORTH)
        add(JBScrollPane(list), BorderLayout.CENTER)

        refreshBtn.addActionListener { reload() }
        stopBtn.addActionListener {
            val idx = list.selectedIndex
            if (idx in agentIds.indices) {
                val id = agentIds[idx]
                executor.submit {
                    try {
                        client().stopAgent(id)
                        reload()
                    } catch (ex: Exception) {
                        SwingUtilities.invokeLater { status.text = "stop failed: ${ex.message}" }
                    }
                }
            }
        }
    }

    fun start() {
        val interval = AistackSettings.instance().state.refreshIntervalMs
        executor.scheduleAtFixedRate({ reload() }, 0L, interval, TimeUnit.MILLISECONDS)
    }

    private fun client(): AistackClient {
        val s = AistackSettings.instance().state
        return AistackClient(s.daemonUrl, AistackSettings.instance().effectiveToken(), s.requestTimeoutMs)
    }

    private fun reload() {
        executor.submit {
            try {
                val agents = client().listAgents()
                val sorted = agents.sortedWith(compareBy({ statusOrder(it.status) }, { it.type }))
                ApplicationManager.getApplication().invokeLater {
                    listModel.clear()
                    agentIds.clear()
                    for (a in sorted) {
                        agentIds += a.id
                        val name = a.name ?: a.type
                        listModel.addElement("[${a.status}] $name (${a.id.take(8)})")
                    }
                    status.text = "aistack — ${agents.size} agent(s)"
                }
            } catch (ex: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    status.text = "aistack — error: ${ex.message}"
                    listModel.clear()
                    agentIds.clear()
                }
            }
        }
    }

    private fun statusOrder(s: String): Int = when (s) {
        "running" -> 0
        "idle" -> 1
        "completed" -> 2
        "failed" -> 3
        "stopped" -> 4
        else -> 5
    }
}
