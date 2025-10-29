package com.tabnineCommon.chat.lens

import com.github.continuedev.continueintellijextension.actions.getContinuePluginService
import com.github.continuedev.continueintellijextension.editor.EditorUtils
import com.github.continuedev.continueintellijextension.services.ContinueExtensionSettings
import com.github.continuedev.continueintellijextension.utils.incrementFeatureCount
import com.intellij.codeInsight.hints.FactoryInlayHintsCollector
import com.intellij.codeInsight.hints.InlayHintsSink
import com.intellij.codeInsight.hints.InlayPresentationFactory
import com.intellij.codeInsight.hints.presentation.InlayPresentation
import com.intellij.codeInsight.hints.presentation.SequencePresentation
import com.intellij.icons.AllIcons
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiElement
import com.intellij.psi.util.elementType
import java.awt.Point
import java.awt.event.KeyEvent
import java.awt.event.MouseEvent

class TabnineLensCollector(
    editor: Editor,
    private val enabledElementTypes: List<String>,
) : FactoryInlayHintsCollector(editor) {
    companion object {
        private const val ID = "com.tabnine.chat.lens"
    }

//    private val binaryRequestFacade = DependencyContainer.instanceOfBinaryRequestFacade()

    override fun collect(element: PsiElement, editor: Editor, sink: InlayHintsSink): Boolean {
//        if (!isChatEnabled()) {
//            return false
//        }
        if (element.elementType.toString() in enabledElementTypes) {
            if (ContinueExtensionSettings.instance.continueState.interactionMode == 1) {
                sink.addBlockElement(
                    offset = element.textRange.startOffset,
                    relatesToPrecedingText = true,
                    showAbove = true,
                    priority = 0,
                    presentation = factory.seq(
                        factory.textSpacePlaceholder(countLeadingWhitespace(editor, element), false),
                        factory.icon(IconLoader.getIcon("/icons/continue_lens.svg", javaClass)),
                        buildQuickActionItem("解释代码", "解释代码", editor, element, false),
                        buildQuickActionItem("生成单元测试", "生成单元测试", editor, element, true),
                        buildQuickActionItem("生成代码注释", "生成代码注释", editor, element, true),
                        buildQuickActionItem("生成优化建议", "生成优化建议", editor, element, true),
                    )
                )
            } else if (ContinueExtensionSettings.instance.continueState.interactionMode == 0) {
                val inlResult: InlResult =
                    object : InlResult {
                        override fun onClick(editor: Editor, element: PsiElement, event: MouseEvent) {
                            if (editor.project != null) {
                                val popupActions: List<String> =
                                    arrayListOf("解释代码", "生成单元测试", "生成代码注释", "生成优化建议")
                                val popup: JBPopup = JBPopupFactory.getInstance()
                                    .createListPopup(object : BaseListPopupStep<String>("", popupActions) {
                                        override fun getTextFor(value: String): String {
                                            return value
                                        }

                                        override fun onChosen(
                                            selectedValue: String,
                                            finalChoice: Boolean
                                        ): PopupStep<*>? {
                                            val project = editor.project
                                            if (project != null) {
                                                incrementFeatureCount(project, selectedValue)
                                            }

                                            // 特殊处理"生成代码注释"操作，直接调用编辑方法而不是对话模式
                                            if (selectedValue == "生成代码注释") {
                                                handleGenerateCommentsInEditMode(editor, element)
                                            } else {
                                                selectElementRange(editor, element)
                                                sendCodeToChat(editor, selectedValue)
                                            }
                                            return FINAL_CHOICE
                                        }
                                    })
                                popup.showInScreenCoordinates(editor.component, event.locationOnScreen)
                            }
                        }

                        override val regularText: String
                            get() {
                                return ""
                            }
                    }
                val presentations: ArrayList<InlayPresentation> = ArrayList()
                presentations.add(factory.textSpacePlaceholder(countLeadingWhitespace(editor, element), true))
                presentations.add(factory.icon(IconLoader.getIcon("/icons/continue.svg", javaClass)))
                presentations.add(factory.icon(AllIcons.Actions.FindAndShowNextMatchesSmall))
                presentations.add(factory.textSpacePlaceholder(1, true))
                val shiftedPresentation = SequencePresentation(presentations)
                val finalPresentation = factory.referenceOnHover(
                    shiftedPresentation,
                    object : InlayPresentationFactory.ClickListener {
                        override fun onClick(event: MouseEvent, translated: Point) {
                            inlResult.onClick(editor, element, event)
                        }
                    }
                )

                sink.addBlockElement(
                    offset = element.textRange.startOffset,
                    relatesToPrecedingText = true,
                    showAbove = true,
                    priority = 0,
                    presentation = finalPresentation
                )
            }
        }
        return true
    }

    private fun buildQuickActionItem(
        label: String,
        intent: String,
        editor: Editor,
        element: PsiElement,
        includeSeparator: Boolean
    ): InlayPresentation {
        return factory.seq(
            factory.smallText(" "),
            factory.smallText(if (includeSeparator) "| " else ""),
            factory.referenceOnHover(
                factory.smallText(label),
                object : InlayPresentationFactory.ClickListener {
                    override fun onClick(event: MouseEvent, translated: Point) {
                        val project = editor.project
                        if (project != null) {
                            incrementFeatureCount(project, intent)
                        }

                        // 特殊处理"生成代码注释"操作，直接调用编辑方法而不是对话模式
                        if (intent == "生成代码注释") {
                            handleGenerateCommentsInEditMode(editor, element)
                        } else {
                            selectElementRange(editor, element)
                            sendCodeToChat(editor, intent)
                        }
                    }
                },
            )
        )
    }

    private fun selectElementRange(editor: Editor, element: PsiElement) {
        val selectionModel = editor.selectionModel
        val range = element.textRange
        selectionModel.setSelection(range.startOffset, range.endOffset)
    }

    private fun countLeadingWhitespace(editor: Editor, element: PsiElement): Int {
        val lineNumber = editor.document.getLineNumber(element.textRange.startOffset)
        return editor.document.getText(
            TextRange(
                editor.document.getLineStartOffset(lineNumber),
                editor.document.getLineEndOffset(lineNumber)
            )
        ).takeWhile { it.isWhitespace() }.length
    }

    interface InlResult {
        fun onClick(var1: Editor, var2: PsiElement, var3: MouseEvent)

        val regularText: String
    }

    private fun getShortcutText(keycode: Int, modifiers: Int): String {
        return KeyEvent.getModifiersExText(modifiers) + "+" + KeyEvent.getKeyText(keycode)
    }

    /**
     * 发送选中的代码到聊天窗口，包含提示词并自动触发发送
     */
    private fun sendCodeToChat(editor: Editor, prompt: String) {
        val project = editor.project ?: return
        val continuePluginService = getContinuePluginService(project) ?: return

        // 如果当前是 structured-agent 模式，则创建新会话
        continuePluginService.sendToWebview("newSessionIfStructuredAgent", null)
        // 先切换到智能体模式，再发送代码
        continuePluginService.sendToWebview("setMode", "agent")

        // 聚焦到Continue输入框
        continuePluginService.continuePluginWindow?.content?.components?.get(0)?.requestFocus()
        continuePluginService.sendToWebview("focusContinueInputWithoutClear", null)

        // 发送选中的代码到聊天窗口，同时包含提示词并自动触发发送
        sendHighlightedCodeWithPrompt(continuePluginService, editor, prompt)
    }

    /**
     * 发送高亮代码并包含提示词，自动触发聊天发送
     */
    private fun sendHighlightedCodeWithPrompt(
        continuePluginService: com.github.continuedev.continueintellijextension.services.ContinuePluginService,
        editor: Editor,
        prompt: String
    ) {
        val editorUtils = EditorUtils(editor)
        val rif = editorUtils.getHighlightedRIF() ?: return

        val serializedRif = com.github.continuedev.continueintellijextension.RangeInFileWithContents(
            filepath = rif.filepath,
            range = rif.range,
            contents = rif.contents
        )

        continuePluginService.sendToWebview(
            "highlightedCode",
            com.github.continuedev.continueintellijextension.HighlightedCodePayload(
                rangeInFileWithContents = serializedRif,
                prompt = if (prompt.isNotEmpty()) prompt else null,
                shouldRun = true  // 自动触发发送
            )
        )
    }

    /**
     * 直接调用编辑方法处理生成代码注释，而不是通过聊天对话框
     */
    private fun handleGenerateCommentsInEditMode(editor: Editor, element: PsiElement) {
        // 选中代码元素
        selectElementRange(editor, element)

        val editorUtils = EditorUtils(editor)
        val (prefix, highlighted, suffix) = editorUtils.getHighlightedRangeTriplet()

        // 获取当前项目和插件服务
        val project = editor.project ?: return
        val continuePluginService = getContinuePluginService(project) ?: return

        // 创建 DiffStreamHandler 来处理代码更改
        val (startLine, endLine) = editorUtils.getHighlightedRIF()?.lines ?: return

        val diffStreamHandler = com.github.continuedev.continueintellijextension.editor.DiffStreamHandler(
            project,
            editor,
            startLine,
            endLine,
            onClose = {},
            onFinish = {},
            streamId = null,
            toolCallId = null
        )

        // 获取用户选择的apply模型标题
        var applyModelTitle = "default" // 默认使用default模型
        continuePluginService.coreMessenger?.request("config/getSerializedProfileInfo", null, null) { response ->
            try {
                // 从响应中提取selectedModelByRole.apply.title
                val content = (response as? Map<*, *>)?.get("content") as? Map<*, *>
                val result = content?.get("result") as? Map<*, *>
                val config = result?.get("config") as? Map<*, *>
                val selectedModelByRole = config?.get("selectedModelByRole") as? Map<*, *>
                val applyModel = selectedModelByRole?.get("apply") as? Map<*, *>
                applyModelTitle = applyModel?.get("title") as? String ?: "default"
            } catch (e: Exception) {
                // 如果出现异常，使用默认模型
                applyModelTitle = "default"
            }
        }

        // 等待获取模型标题（设置超时）
        val startTime = System.currentTimeMillis()
        while (applyModelTitle == "default" && System.currentTimeMillis() - startTime < 1500) {
            Thread.sleep(20)
        }

        // 直接调用streamDiffLines方法处理代码注释生成，使用用户选择的apply模型
        diffStreamHandler.streamDiffLinesToEditor(
            "请为以下代码添加详细注释",
            prefix,
            highlighted,
            suffix,
            applyModelTitle, // 使用用户选择的apply模型标题
            true
        )
    }
}
