package com.github.continuedev.continueintellijextension.editor

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager

@Service(Service.Level.PROJECT)
class DiffStreamService {
    private val handlers = mutableMapOf<Editor, DiffStreamHandler>()

    fun register(handler: DiffStreamHandler, editor: Editor) {
        if (handlers.containsKey(editor)) {
            handlers[editor]?.rejectAll()
        }
        handlers[editor] = handler
        println("Registered handler for editor")
    }

    fun reject(editor: Editor) {
        handlers[editor]?.rejectAll()
        handlers.remove(editor)

        ApplicationManager.getApplication().invokeLater {
            FileDocumentManager.getInstance().saveAllDocuments()
        }
    }

    fun accept(editor: Editor) {
        handlers[editor]?.acceptAll()
        handlers.remove(editor)

        ApplicationManager.getApplication().invokeLater {
            FileDocumentManager.getInstance().saveAllDocuments()
        }
    }
}