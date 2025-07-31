package com.github.continuedev.continueintellijextension.utils

import com.github.continuedev.continueintellijextension.services.ContinuePluginService
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project

fun incrementFeatureCount (project: Project, featureName: String) {
    val pluginService = project.service<ContinuePluginService>()
    pluginService.sendToWebview("incrementFeatureCount", featureName)
}