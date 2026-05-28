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

/**
 * Send the current selection (or whole document) to the aistack review loop.
 */
class RunReviewLoopAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: run {
            Messages.showWarningDialog(project, "No active editor.", "aistack")
            return
        }
        val codeInput = editor.selectionModel.selectedText?.takeIf { it.isNotBlank() }
            ?: editor.document.text
        if (codeInput.isBlank()) {
            Messages.showWarningDialog(project, "Nothing to review.", "aistack")
            return
        }
        val iterStr = Messages.showInputDialog(
            project,
            "Max review iterations:",
            "aistack: Run Review Loop",
            null,
            "3",
            null
        ) ?: return
        val maxIterations = iterStr.toIntOrNull()?.takeIf { it > 0 } ?: run {
            Messages.showWarningDialog(project, "Please enter a positive integer.", "aistack")
            return
        }

        val settings = AistackSettings.instance().state
        val client = AistackClient(
            baseUrl = settings.daemonUrl,
            token = AistackSettings.instance().effectiveToken(),
            timeoutMs = settings.requestTimeoutMs
        )

        object : Task.Backgroundable(project, "aistack: starting review loop", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val loop = client.startReviewLoop(
                        AistackClient.StartReviewLoopRequest(codeInput = codeInput, maxIterations = maxIterations)
                    )
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showInfoMessage(
                            project,
                            "Review loop ${loop.id} started (status: ${loop.status}).",
                            "aistack"
                        )
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
}
