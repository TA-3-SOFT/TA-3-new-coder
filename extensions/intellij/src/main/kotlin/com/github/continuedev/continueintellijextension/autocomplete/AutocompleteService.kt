package com.github.continuedev.continueintellijextension.autocomplete

import com.github.continuedev.continueintellijextension.services.ContinueExtensionSettings
import com.github.continuedev.continueintellijextension.services.ContinuePluginService
import com.github.continuedev.continueintellijextension.utils.toUriOrNull
import com.github.continuedev.continueintellijextension.utils.uuid
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.injected.editor.VirtualFileWindow
import com.intellij.openapi.application.*
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.ServiceManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.InlayProperties
import com.intellij.openapi.editor.impl.EditorImpl
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.wm.WindowManager
import com.intellij.psi.JavaRecursiveElementVisitor
import com.intellij.psi.PsiClass
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiImportStatement
import com.intellij.psi.PsiJavaFile
import com.intellij.psi.PsiModifier
import java.util.ArrayList
import java.util.LinkedHashSet
import java.util.Objects

data class PendingCompletion(
    val editor: Editor,
    var offset: Int,
    val completionId: String,
    var text: String?
)


fun PsiElement.isInjectedText(): Boolean {
    val virtualFile = this.containingFile.virtualFile ?: return false
    if (virtualFile is VirtualFileWindow) {
        return true
    }
    return false
}

fun Editor.addInlayElement(
    lines: List<String>,
    offset: Int,
    properties: InlayProperties
) {
    if (this is EditorImpl) {
        if (lines[0].isNotEmpty()) {
            inlayModel.addInlineElement(offset, properties, ContinueInlayRenderer(listOf(lines[0])))
        }
        if (lines.size > 1) {
            inlayModel.addBlockElement(offset, properties, ContinueInlayRenderer(lines.drop(1)))
        }
    }
}

@Service(Service.Level.PROJECT)
class AutocompleteService(private val project: Project) {
    var pendingCompletion: PendingCompletion? = null
    private val autocompleteLookupListener = project.service<AutocompleteLookupListener>()
    private val widget: AutocompleteSpinnerWidget? by lazy {
        WindowManager.getInstance().getStatusBar(project)
            ?.getWidget(AutocompleteSpinnerWidget.ID) as? AutocompleteSpinnerWidget
    }

    // To avoid triggering another completion on partial acceptance,
    // we need to keep track of whether the last change was a partial accept
    var lastChangeWasPartialAccept = false

    fun triggerCompletion(editor: Editor) {
        val settings =
            ServiceManager.getService(ContinueExtensionSettings::class.java)
        if (!settings.continueState.enableTabAutocomplete) {
            return
        }

        if (pendingCompletion != null) {
            clearCompletions(pendingCompletion!!.editor)
        }

        // Set pending completion
        val completionId = uuid()
        val offset = editor.caretModel.primaryCaret.offset
        pendingCompletion = PendingCompletion(editor, offset, completionId, null)

        // Request a completion from the core
        val virtualFile = FileDocumentManager.getInstance().getFile(editor.document)

        val uri = virtualFile?.toUriOrNull() ?: return

        widget?.setLoading(true)

        val line = editor.caretModel.primaryCaret.logicalPosition.line
        val column = editor.caretModel.primaryCaret.logicalPosition.column

        // 转换为格式化的 JSON 字符串
//        val gson = GsonBuilder().setPrettyPrinting().create()
//        val symbolTable = gson.toJson(buildSymbolTable(editor))
        // 不格式化 节约token 不影响效果
        val symbolTable = buildSymbolTable(editor).toString()

        val input = mapOf(
            "completionId" to completionId,
            "filepath" to uri,
            "pos" to mapOf(
                "line" to line,
                "character" to column
            ),
            "clipboardText" to "",
            "recentlyEditedRanges" to emptyList<Any>(),
            "recentlyVisitedRanges" to emptyList<Any>(),
            "symbolTable" to symbolTable,
        )

        project.service<ContinuePluginService>().coreMessenger?.request(
            "autocomplete/complete",
            input,
            null,
            ({ response ->
                if (pendingCompletion == null || pendingCompletion?.completionId == completionId) {
                    widget?.setLoading(false)
                }

                val responseObject = response as Map<*, *>
                val completions = responseObject["content"] as List<*>

                if (completions.isNotEmpty()) {
                    val completion = completions[0].toString()
                    val finalTextToInsert = deduplicateCompletion(editor, offset, completion)

                    if (shouldRenderCompletion(finalTextToInsert, offset, line, editor)) {
                        renderCompletion(editor, offset, finalTextToInsert)
                        pendingCompletion = PendingCompletion(editor, offset, completionId, finalTextToInsert)
                    }
                }
            })
        )
    }

    private fun shouldRenderCompletion(completion: String, offset: Int, line: Int, editor: Editor): Boolean {
        if (completion.isEmpty() || runReadAction { offset != editor.caretModel.offset }) {
            return false
        }

        if (completion.lines().size == 1) {
            return true
        }

        val endOffset = editor.document.getLineEndOffset(line)

        // Do not render if completion is multi-line and caret is in middle of line
        return offset <= endOffset && editor.document.getText(TextRange(offset, endOffset)).isBlank()
    }

    private fun deduplicateCompletion(editor: Editor, offset: Int, completion: String): String {
        // Check if completion matches the first 10 characters after the cursor
        return ApplicationManager.getApplication().runReadAction<String> {
            val document = editor.document
            val caretOffset = editor.caretModel.offset

            // Don't care about it if it's at the end of the document
            if (caretOffset == document.textLength) return@runReadAction completion

            val N = 10
            var textAfterCursor = if (caretOffset + N <= document.textLength) {
                document.getText(TextRange(caretOffset, caretOffset + N))
            } else {
                document.getText(TextRange(caretOffset, document.textLength))
            }

            // Avoid truncating the completion text when the text after the cursor is blank
            if (textAfterCursor.isBlank()) return@runReadAction completion

            // Determine the index of a newline character within the text following the cursor.
            val newlineIndex = textAfterCursor.indexOf("\r\n").takeIf { it >= 0 } ?: textAfterCursor.indexOf('\n')
            // If a newline character is found and the current line is not empty, truncate the text at that point.
            if (newlineIndex > 0) {
                textAfterCursor = textAfterCursor.substring(0, newlineIndex)
            }

            val indexOfTextAfterCursorInCompletion = completion.indexOf(textAfterCursor)
            if (indexOfTextAfterCursorInCompletion > 0) {
                return@runReadAction completion.slice(0..indexOfTextAfterCursorInCompletion - 1)
            } else if (indexOfTextAfterCursorInCompletion == 0) {
                return@runReadAction ""
            }

            return@runReadAction completion
        }
    }

    private fun renderCompletion(editor: Editor, offset: Int, completion: String) {
        if (completion.isEmpty()) {
            return
        }
        if (isInjectedFile(editor)) return
        // Skip rendering completions if the code completion dropdown is already visible and the IDE completion side-by-side setting is disabled
        if (shouldSkipRender(ServiceManager.getService(ContinueExtensionSettings::class.java))) {
            return
        }

        ApplicationManager.getApplication().invokeLater {
            WriteAction.run<Throwable> {
                // Clear existing completions
                hideCompletions(editor)

                val properties = InlayProperties()
                properties.relatesToPrecedingText(true)
                properties.disableSoftWrapping(true)

                val lines = completion.lines()
                pendingCompletion = pendingCompletion?.copy(text = lines.joinToString("\n"))
                editor.addInlayElement(lines, offset, properties)

//                val attributes = TextAttributes().apply {
//                    backgroundColor = JBColor.GREEN
//                }
//                val key = TextAttributesKey.createTextAttributesKey("CONTINUE_AUTOCOMPLETE")
//                key.let { editor.colorsScheme.setAttributes(it, attributes) }
//                editor.markupModel.addLineHighlighter(key, editor.caretModel.logicalPosition.line, HighlighterLayer.LAST)
            }
        }
    }

    fun accept() {
        val completion = pendingCompletion ?: return
        val text = completion.text ?: return
        val editor = completion.editor
        val offset = completion.offset
        editor.document.insertString(offset, text)

        editor.caretModel.moveToOffset(offset + text.length)

        project.service<ContinuePluginService>().coreMessenger?.request(
            "autocomplete/accept",
            hashMapOf("completionId" to completion.completionId),
            null,
            ({})
        )
        invokeLater {
            clearCompletions(editor, completion)
        }
    }

    private fun shouldSkipRender(settings: ContinueExtensionSettings) =
        !settings.continueState.showIDECompletionSideBySide && !autocompleteLookupListener.isLookupEmpty()


    private fun splitKeepingDelimiters(input: String, delimiterPattern: String = "\\s+"): List<String> {
        val initialSplit = input.split("(?<=$delimiterPattern)|(?=$delimiterPattern)".toRegex())
            .filter { it.isNotEmpty() }

        val result = mutableListOf<String>()
        var currentDelimiter = ""

        for (part in initialSplit) {
            if (part.matches(delimiterPattern.toRegex())) {
                currentDelimiter += part
            } else {
                if (currentDelimiter.isNotEmpty()) {
                    result.add(currentDelimiter)
                    currentDelimiter = ""
                }
                result.add(part)
            }
        }

        if (currentDelimiter.isNotEmpty()) {
            result.add(currentDelimiter)

        }

        return result
    }

    fun partialAccept() {
        val completion = pendingCompletion ?: return
        val text = completion.text ?: return
        val editor = completion.editor
        val offset = completion.offset

        lastChangeWasPartialAccept = true

        // Split the text into words, keeping delimiters
        val words = splitKeepingDelimiters(text)
        println(words)
        val word = words[0]
        editor.document.insertString(offset, word)
        editor.caretModel.moveToOffset(offset + word.length)

        // Remove the completion and re-display it
        hideCompletions(editor)
        completion.text = text.substring(word.length)
        completion.offset += word.length
        renderCompletion(editor, completion.offset, completion.text!!)
    }

    private fun cancelCompletion(completion: PendingCompletion) {
        // Send cancellation message to core
        widget?.setLoading(false)
        project.service<ContinuePluginService>().coreMessenger?.request("autocomplete/cancel", null, null, ({}))
    }

    fun clearCompletions(editor: Editor, completion: PendingCompletion? = pendingCompletion) {
        if (isInjectedFile(editor)) return

        if (completion != null) {
            cancelCompletion(completion)
            if (completion.completionId == pendingCompletion?.completionId) pendingCompletion = null
        }
        disposeInlayRenderer(editor)
    }

    private fun isInjectedFile(editor: Editor): Boolean {
        return runReadAction {
            PsiDocumentManager.getInstance(project).getPsiFile(editor.document)?.isInjectedText() ?: false
        }
    }

    fun hideCompletions(editor: Editor) {
        if (isInjectedFile(editor)) return

        disposeInlayRenderer(editor)
    }

    private fun disposeInlayRenderer(editor: Editor) {
        editor.inlayModel.getInlineElementsInRange(0, editor.document.textLength).forEach {
            if (it.renderer is ContinueInlayRenderer) {
                it.dispose()
            }
        }
        editor.inlayModel.getBlockElementsInRange(0, editor.document.textLength).forEach {
            if (it.renderer is ContinueInlayRenderer) {
                it.dispose()
            }
        }
    }


    private fun buildSymbolTable(editor: Editor): MutableList<JsonObject?> {
        val project = editor.getProject()
        if (project == null) {
            return ArrayList<JsonObject?>()
        }

        val psiFile = PsiDocumentManager.getInstance(Objects.requireNonNull<Project?>(editor.getProject()))
            .getPsiFile(editor.getDocument())
        if (psiFile == null) {
            return ArrayList<JsonObject?>()
        }

        var currentFilePackageName = ""

        if (psiFile is PsiJavaFile) {
            val split: Array<String?> =
                psiFile.getPackageName().split("\\.".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
            if (split.size >= 2) {
                currentFilePackageName = split[0] + "." + split[1]
            }
        }

        // 遍历当前文件中的所有元素，查找关联文件
        val finalCurrentFilePackageName = currentFilePackageName


        val symbolTableList: MutableList<JsonObject?> = ArrayList<JsonObject?>()

        psiFile.accept(object : JavaRecursiveElementVisitor() {
            override fun visitElement(element: PsiElement) {
                super.visitElement(element)
                // 查找导入的类
                if (element is PsiImportStatement) {
                    val importStatement = element
                    val resolved = importStatement.resolve()
                    if (resolved is PsiClass) {
                        val psiClass = resolved
                        if (psiClass.getQualifiedName() != null && (psiClass.getQualifiedName()!!
                                .startsWith("com.yinhai") || (!finalCurrentFilePackageName.isEmpty() && psiClass.getQualifiedName()!!
                                .startsWith(finalCurrentFilePackageName)))
                        ) {
                            val jsonObject: JsonObject = processPsiClass(psiClass)
                            symbolTableList.add(jsonObject)
                        }
                    }
                }

                // 查找继承和实现关系
                if (element is PsiClass) {
                    val psiClass = element
                    for (superClass in psiClass.getSupers()) {
                        val jsonObject: JsonObject = processPsiClass(superClass)
                        symbolTableList.add(jsonObject)
                    }
                }
            }
        })

        //去重复
        val set: MutableSet<JsonObject?> = LinkedHashSet<JsonObject?>(symbolTableList)
        return ArrayList<JsonObject?>(set)
    }

    private fun processPsiClass(psiClass: PsiClass): JsonObject {
        val className = psiClass.getQualifiedName()
        val classSymbolTable = JsonObject()
        if (className == null) {
            return classSymbolTable
        }

        classSymbolTable.addProperty("className", className)
        val psiClassComment = psiClass.getDocComment()
        if (psiClassComment != null) {
            val commentText = StringBuilder()
            // 获取所有的描述性内容（不包括标签）
            psiClassComment.getDescriptionElements()
            for (element in psiClassComment.getDescriptionElements()) {
                commentText.append(element.getText().trim { it <= ' ' }).append(" ")
            }
            classSymbolTable.addProperty("classComment", commentText.toString().trim { it <= ' ' })
        }

        val publicMethods = JsonArray()
        val publicFields = JsonArray()

        // 查找公共方法
        for (method in psiClass.getMethods()) {
            if (method.hasModifierProperty(PsiModifier.PUBLIC)) {
                val methodSymbolTable = JsonObject()

                //获取方法签名
                val signature = StringBuilder()
                // 获取方法的返回类型
                val returnType = method.getReturnType()
                if (returnType != null) {
                    signature.append(returnType.getPresentableText()).append(" ")
                }
                // 获取方法的名称
                signature.append(method.getName())
                // 获取方法的参数列表
                signature.append("(")
                val parameters = method.getParameterList().getParameters()
                for (i in parameters.indices) {
                    val parameter = parameters[i]
                    val parameterType = parameter.getType()
                    signature.append(parameterType.getPresentableText()).append(" ").append(parameter.getName())
                    if (i < parameters.size - 1) {
                        signature.append(", ")
                    }
                }
                signature.append(")")
                methodSymbolTable.addProperty("methodSignature", signature.toString())

                // 获取方法的注释
                val docComment = method.getDocComment()
                if (docComment != null) {
//                    String commentText = docComment.getText();
                    val commentText = StringBuilder()
                    // 获取所有的描述性内容（不包括标签）
                    docComment.getDescriptionElements()
                    for (element in docComment.getDescriptionElements()) {
                        commentText.append(element.getText().trim { it <= ' ' }).append(" ")
                    }
                    methodSymbolTable.addProperty("methodComment", commentText.toString().trim { it <= ' ' })
                }
                publicMethods.add(methodSymbolTable)
            }
        }

        // 查找公共属性
        for (field in psiClass.getFields()) {
            if (field.hasModifierProperty(PsiModifier.PUBLIC)) {
                val fieldSymbolTable = JsonObject()


                // 获取字段签名
                val signature = StringBuilder()
                val fieldType = field.getType()
                signature.append(fieldType.getPresentableText()).append(" ")
                signature.append(field.getName())
                fieldSymbolTable.addProperty("fieldSignature", signature.toString())

                // 获取方法的注释
                val docComment = field.getDocComment()
                if (docComment != null) {
//                    String commentText = docComment.getText();
                    val commentText = StringBuilder()
                    // 获取所有的描述性内容（不包括标签）
                    docComment.getDescriptionElements()
                    for (element in docComment.getDescriptionElements()) {
                        commentText.append(element.getText().trim { it <= ' ' }).append(" ")
                    }
                    fieldSymbolTable.addProperty("fieldComment", commentText.toString().trim { it <= ' ' })
                }
                publicFields.add(fieldSymbolTable)
            }
        }

        classSymbolTable.add("publicMethods", publicMethods)
        classSymbolTable.add("publicFields", publicFields)
        return classSymbolTable
    }
}
