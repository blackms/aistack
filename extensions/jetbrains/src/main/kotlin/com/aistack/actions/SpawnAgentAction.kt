package com.aistack.actions

import com.aistack.client.AistackClient
import com.aistack.client.AistackException
import com.aistack.settings.AistackSettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.testFramework.LightVirtualFile

/**
 * Spawn a coder agent and execute it on the current editor selection.
 *
 * Opens a result panel as a scratch file inside the IDE.
 */
class SpawnAgentAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: run {
            Messages.showWarningDialog(project, "No active editor.", "aistack")
            return
        }
        val selection = editor.selectionModel.selectedText
        if (selection.isNullOrBlank()) {
            Messages.showWarningDialog(project, "Empty selection.", "aistack")
            return
        }
        val task = Messages.showInputDialog(
            project,
            "Task for the coder agent:",
            "aistack: Spawn Agent on Selection",
            null,
            "refactor this code",
            null
        ) ?: return

        val settings = AistackSettings.instance().state
        val client = AistackClient(
            baseUrl = settings.daemonUrl,
            token = AistackSettings.instance().effectiveToken(),
            timeoutMs = settings.requestTimeoutMs
        )

        object : Task.Backgroundable(project, "aistack: spawning agent", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.text = "Spawning ${settings.defaultAgentType}..."
                try {
                    val agent = client.spawnAgent(
                        AistackClient.SpawnAgentRequest(type = settings.defaultAgentType)
                    )
                    indicator.text = "Executing task on agent ${agent.id}"
                    val fullTask = buildString {
                        append(task).append("\n\n")
                        append("File: ").append(editor.virtualFile?.path ?: "<unknown>").append('\n')
                        append("Selected code:\n```\n").append(selection).append("\n```\n")
                    }
                    val result = client.executeAgent(agent.id, fullTask)
                    val content = "# aistack agent ${agent.id} response\n\n${result.response}\n"
                    ApplicationManager.getApplication().invokeLater {
                        showResult(project, agent.id, content)
                    }
                } catch (ex: AistackException) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, ex.message ?: "Unknown error", "aistack")
                    }
                } catch (ex: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, ex.message ?: "Unknown error", "aistack")
                    }
                }
            }
        }.queue()
    }

    private fun showResult(project: com.intellij.openapi.project.Project, agentId: String, content: String) {
        val vf = LightVirtualFile("aistack-agent-$agentId.md", content)
        FileEditorManager.getInstance(project).openFile(vf, true)
        // Ensure VFS picks up the temp file
        VirtualFileManager.getInstance().asyncRefresh(null)
        OpenFileDescriptor(project, vf).navigate(true)
    }
}
