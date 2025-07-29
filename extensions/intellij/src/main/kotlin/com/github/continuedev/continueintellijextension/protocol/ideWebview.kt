package com.github.continuedev.continueintellijextension.protocol

data class CopyTextParams(
    val text: String
)

data class ApplyToFileParams(
    val text: String,
    val startLine: Int,
    val endLine: Int,
    val streamId: String,
    val filepath: String?,
    val toolCallId: String?
)

data class InsertAtCursorParams(
    val text: String
)

