package com.github.continuedev.continueintellijextension.services

import com.intellij.openapi.components.Service
import com.posthog.java.PostHog
import com.posthog.java.PostHog.Builder

@Service
class TelemetryService {
    private val POSTHOG_API_KEY = "phc_JS6XFROuNbhJtVCEdTSYk6gl5ArRrTNMpCcguAXlSPs"
    private var posthog: PostHog? = null;
    private var distinctId: String? = null;
    
    fun setup(distinctId: String) {
        // Telemetry disabled - no setup
    }

    fun capture(eventName: String, properties: Map<String, *>) {
        // Telemetry disabled - no data collection
    }

    fun shutdown() {
        this.posthog?.shutdown()
    }
}