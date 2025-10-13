package com.github.continuedev.continueintellijextension.`continue`

import com.github.continuedev.continueintellijextension.*
import com.github.continuedev.continueintellijextension.constants.ContinueConstants
import com.github.continuedev.continueintellijextension.constants.getContinueGlobalPath
import com.github.continuedev.continueintellijextension.services.ContinueExtensionSettings
import com.github.continuedev.continueintellijextension.services.ContinuePluginService
import com.github.continuedev.continueintellijextension.utils.*
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.DiffRequestPanel
import com.intellij.diff.contents.DiffContent
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.util.ExecUtil
import com.intellij.history.LocalHistoryException
import com.intellij.history.integration.ui.models.HistoryDialogModel
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.impl.DocumentMarkupModel
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.testFramework.LightVirtualFile
import kotlinx.coroutines.*
import java.awt.Toolkit
import java.awt.datatransfer.DataFlavor
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.io.InputStreamReader
import java.net.URI
import java.nio.charset.Charset
import javax.swing.Action
import javax.swing.JComponent

class IntelliJIDE(
    private val project: Project,
    private val continuePluginService: ContinuePluginService,

    ) : IDE {

    private val gitService = GitService(project, continuePluginService)

    private val ripgrep: String = getRipgrepPath()

    init {
        try {
            val os = getOS()

            if (os == OS.LINUX || os == OS.MAC) {
                val file = File(ripgrep)
                if (!file.canExecute()) {
                    file.setExecutable(true)
                }
            }
        } catch (e: Throwable) {
            e.printStackTrace()
        }
    }

    override suspend fun getIdeInfo(): IdeInfo {
        val applicationInfo = ApplicationInfo.getInstance()
        val ideName: String = applicationInfo.fullApplicationName
        val ideVersion = applicationInfo.fullVersion
        val sshClient = System.getenv("SSH_CLIENT")
        val sshTty = System.getenv("SSH_TTY")

        var remoteName = "local"
        if (sshClient != null || sshTty != null) {
            remoteName = "ssh"
        }

        val pluginId = ContinueConstants.PLUGIN_ID
        val plugin = PluginManagerCore.getPlugin(PluginId.getId(pluginId))
        val extensionVersion = plugin?.version ?: "Unknown"

        return IdeInfo(
            ideType = "jetbrains",
            name = ideName,
            version = ideVersion,
            remoteName = remoteName,
            extensionVersion = extensionVersion
        )
    }

    suspend fun enableHubContinueDev(): Boolean {
        return true
    }

    override suspend fun getIdeSettings(): IdeSettings {
        val settings = service<ContinueExtensionSettings>()


        return IdeSettings(
            remoteConfigServerUrl = settings.continueState.remoteConfigServerUrl,
            remoteConfigSyncPeriod = settings.continueState.remoteConfigSyncPeriod,
            userToken = settings.continueState.userToken ?: "",
            continueTestEnvironment = "production",
            pauseCodebaseIndexOnStart = false, // TODO: Needs to be implemented
        )
    }

    override suspend fun getDiff(includeUnstaged: Boolean): List<String> {
        return gitService.getDiff(includeUnstaged)
    }

    override suspend fun getClipboardContent(): Map<String, String> {
        val clipboard = Toolkit.getDefaultToolkit().systemClipboard
        val data = withContext(Dispatchers.IO) {
            clipboard.getData(DataFlavor.stringFlavor)
        }
        val text = data as? String ?: ""
        return mapOf("text" to text)
    }

    override suspend fun isTelemetryEnabled(): Boolean {
        return true
    }

    override suspend fun getUniqueId(): String {
        return getMachineUniqueID()
    }

    override suspend fun getTerminalContents(): String {
        return ""
    }

    override suspend fun getDebugLocals(threadIndex: Int): String {
        throw NotImplementedError("getDebugLocals not implemented yet")
    }

    override suspend fun getTopLevelCallStackSources(threadIndex: Int, stackDepth: Int): List<String> {
        throw NotImplementedError("getTopLevelCallStackSources not implemented")
    }

    override suspend fun getAvailableThreads(): List<Thread> {
        throw NotImplementedError("getAvailableThreads not implemented yet")
    }

    override suspend fun getWorkspaceDirs(): List<String> {
        return workspaceDirectories().toList()
    }

    override suspend fun getWorkspaceConfigs(): List<ContinueRcJson> {
        val workspaceDirs = this.getWorkspaceDirs()

        val configs = mutableListOf<String>()

        for (workspaceDir in workspaceDirs) {
            val dir = VirtualFileManager.getInstance().findFileByUrl(workspaceDir)
            if (dir != null) {
                val contents = dir.children.mapNotNull { it.toUriOrNull() }

                // Find any .continuerc.json files
                for (file in contents) {
                    if (file.endsWith(".continuerc.json")) {
                        val fileContent = UriUtils.uriToFile(file).readText()
                        configs.add(fileContent)
                    }
                }
            }
        }

        return configs as List<ContinueRcJson>
    }

    override suspend fun fileExists(filepath: String): Boolean {
        val file = UriUtils.uriToFile(filepath)
        return file.exists()
    }

    override suspend fun writeFile(path: String, contents: String) {
        val file = UriUtils.uriToFile(path)
        file.parentFile?.mkdirs()
        file.writeText(contents)
    }

    override suspend fun showVirtualFile(title: String, contents: String) {
        val virtualFile = LightVirtualFile(title, contents)
        ApplicationManager.getApplication().invokeLater {
            FileEditorManager.getInstance(project).openFile(virtualFile, true)
        }
    }

    override suspend fun getContinueDir(): String {
        return getContinueGlobalPath()
    }

    override suspend fun openFile(path: String) {
        // Convert URI path to absolute file path
        val filePath = UriUtils.uriToFile(path).absolutePath
        // Find the file using the absolute path
        val file = withContext(Dispatchers.IO) {
            LocalFileSystem.getInstance().refreshAndFindFileByPath(filePath)
        }

        file?.let {
            ApplicationManager.getApplication().invokeLater {
                FileEditorManager.getInstance(project).openFile(it, true)
            }
        }
    }

    override suspend fun openUrl(url: String) {
        withContext(Dispatchers.IO) {
            Desktop.browse(URI(url))
        }
    }

    override suspend fun runCommand(command: String) {
        throw NotImplementedError("runCommand not implemented in IntelliJ")
    }

    override suspend fun saveFile(filepath: String) {
        ApplicationManager.getApplication().invokeLater {
            val file =
                LocalFileSystem.getInstance().findFileByPath(UriUtils.parseUri(filepath).path) ?: return@invokeLater
            val fileDocumentManager = FileDocumentManager.getInstance()
            val document = fileDocumentManager.getDocument(file)

            document?.let {
                fileDocumentManager.saveDocument(it)
            }
        }
    }

    override suspend fun saveAllFiles() {
        ApplicationManager.getApplication().invokeLater {
            FileDocumentManager.getInstance().saveAllDocuments()
        }
    }

    override suspend fun readFile(filepath: String): String {
        return try {
            val content = ApplicationManager.getApplication().runReadAction<String?> {
                val virtualFile = LocalFileSystem.getInstance().findFileByPath(UriUtils.parseUri(filepath).path)
                if (virtualFile != null && FileDocumentManager.getInstance().isFileModified(virtualFile)) {
                    return@runReadAction FileDocumentManager.getInstance().getDocument(virtualFile)?.text
                }
                return@runReadAction null
            }

            if (content != null) {
                content
            } else {
                val file = UriUtils.uriToFile(filepath)
                if (!file.exists() || file.isDirectory) return ""
                withContext(Dispatchers.IO) {
                    FileInputStream(file).use { fis ->
                        val sizeToRead = minOf(100000, file.length()).toInt()
                        val buffer = ByteArray(sizeToRead)
                        val bytesRead = fis.read(buffer, 0, sizeToRead)
                        if (bytesRead <= 0) return@use ""
                        String(buffer, 0, bytesRead, Charset.forName("UTF-8"))
                            // `\r` takes up unnecessary tokens
                            .lineSequence().joinToString("\n")
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
            ""
        }
    }

    override suspend fun readFileWithLineNumbers(filepath: String): String {
        val content = readFile(filepath)
        return content.lines().mapIndexed { index, line -> "${index + 1}: $line" }.joinToString("\n")
    }


    override suspend fun readRangeInFile(filepath: String, range: Range): String {
        val fullContents = readFile(filepath)
        val lines = fullContents.lines()
        val startLine = range.start.line
        val startCharacter = range.start.character
        val endLine = range.end.line
        val endCharacter = range.end.character

        val firstLine = lines.getOrNull(startLine)?.substring(startCharacter) ?: ""
        val lastLine = lines.getOrNull(endLine)?.substring(0, endCharacter) ?: ""
        val betweenLines = if (endLine - startLine > 1) {
            lines.subList(startLine + 1, endLine).joinToString("\n")
        } else {
            ""
        }

        return listOf(firstLine, betweenLines, lastLine).filter { it.isNotEmpty() }.joinToString("\n")
    }

    override suspend fun showLines(filepath: String, startLine: Int, endLine: Int) {
        setFileOpen(filepath, true)
    }

    override suspend fun showDiff(filepath: String, newContents: String, stepIndex: Int) {
        continuePluginService.diffManager?.showDiff(filepath, newContents, stepIndex)
    }

    override suspend fun showAgentDiff(filepath: String, timestamp: Long) {

        try {
            // 获取文件的VirtualFile对象
            val virtualFile = LocalFileSystem.getInstance()
                .findFileByPath(UriUtils.uriToFile(filepath).absolutePath)

            if (virtualFile == null) {
                throw IllegalArgumentException("File not found: $filepath")
            }

            val localHistoryImplClass = Class.forName("com.intellij.history.integration.LocalHistoryImpl")
            val getInstanceImplMethod = localHistoryImplClass.getDeclaredMethod("getInstanceImpl")
            val localHistoryImpl = getInstanceImplMethod.invoke(null)

            val gatewayField = localHistoryImplClass.getDeclaredField("gateway")
            gatewayField.isAccessible = true
            val gateway = gatewayField.get(localHistoryImpl)

            val facadeField = localHistoryImplClass.getDeclaredField("facade")
            facadeField.isAccessible = true
            val facade = facadeField.get(localHistoryImpl)

            val fileHistoryModelClass = Class.forName("com.intellij.history.integration.ui.models.EntireFileHistoryDialogModel")
            val constructor = fileHistoryModelClass.getDeclaredConstructor(
                Class.forName("com.intellij.openapi.project.Project"),
                Class.forName("com.intellij.history.integration.IdeaGateway"),
                Class.forName("com.intellij.history.core.LocalHistoryFacade"),
                Class.forName("com.intellij.openapi.vfs.VirtualFile")
            )
            val fileHistoryModel = constructor.newInstance(project, gateway, facade, virtualFile)

            // 获取最适合的历史版本：优先使用指定时间戳之前的版本，如果没有则使用最原始版本
            val targetRevision = LocalHistoryUtil.findBestHistoricalRevision(fileHistoryModel as HistoryDialogModel, timestamp)
                ?: throw LocalHistoryException("No revision history found for file: $filepath")

            // 从历史版本中获取文件内容
            val historicalContent = try {
                val revisionField = targetRevision.javaClass.getDeclaredField("revision")
                revisionField.isAccessible = true
                val revision = revisionField.get(targetRevision)

                val findEntryMethod = revision.javaClass.getDeclaredMethod("findEntry")
                val entry = findEntryMethod.invoke(revision)
                if (entry != null) {
                    val getContentMethod = entry.javaClass.getDeclaredMethod("getContent")
                    val content = getContentMethod.invoke(entry)

                    val bytesField = content.javaClass.getDeclaredMethod("getBytes")
                    val bytes = bytesField.invoke(content) as ByteArray
                    String(bytes, Charset.forName("UTF-8"))
                } else {
                    // 如果历史版本中没有找到文件内容，可能文件在那个时间点不存在
                    ""
                }
            } catch (e: Exception) {
                // 如果获取历史内容失败，使用空字符串
                ""
            }

            // 获取当前文件内容
            val currentContent = readFile(filepath)

            // 显示diff
            showHistoricalDiff(filepath, historicalContent, currentContent, timestamp)

        } catch (e: Exception) {
            e.printStackTrace()
            throw e
        }


    }

    override suspend fun getOpenFiles(): List<String> {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.openFiles.mapNotNull { it.toUriOrNull() }.toList()
    }

    override suspend fun getCurrentFile(): Map<String, Any>? {
        return withContext(Dispatchers.Main) {
            val fileEditorManager = FileEditorManager.getInstance(project)
            val editor = fileEditorManager.selectedTextEditor
            val virtualFile = editor?.document?.let { FileDocumentManager.getInstance().getFile(it) }
            return@withContext virtualFile?.toUriOrNull()?.let {
                mapOf(
                    "path" to it,
                    "contents" to editor.document.text,
                    "isUntitled" to false
                )
            }
        }
    }

    override suspend fun getCurrentFileWithLineNumbers(): Map<String, Any>? {
        return withContext(Dispatchers.Main) {
            val fileEditorManager = FileEditorManager.getInstance(project)
            val editor = fileEditorManager.selectedTextEditor
            val virtualFile = editor?.document?.let { FileDocumentManager.getInstance().getFile(it) }
            return@withContext virtualFile?.toUriOrNull()?.let {
                mapOf(
                    "path" to it,
                    "contents" to editor.document.text.lines().mapIndexed { index, line -> "${index + 1}: $line" }
                        .joinToString("\n"),
                    "isUntitled" to false
                )
            }
        }
    }

    override suspend fun getPinnedFiles(): List<String> {
        // Returning open files for now as per existing code
        return getOpenFiles()
    }

    override suspend fun getFileResults(pattern: String): List<String> {
        val ideInfo = this.getIdeInfo()
        if (ideInfo.remoteName == "local") {
            try {
                val command = GeneralCommandLine(
                    ripgrep,
                    "--files",
                    "--iglob",
                    pattern,
                    "--ignore-file",
                    ".continueignore",
                    "--ignore-file",
                    ".gitignore",
                )

                command.setWorkDirectory(project.basePath)
                val results = ExecUtil.execAndGetOutput(command).stdout
                return results.split("\n")
            } catch (e: Exception) {
                showToast(
                    ToastType.ERROR,
                    "Error executing ripgrep: ${e.message}"
                )
                return emptyList()
            }
        } else {
            throw NotImplementedError("Ripgrep not supported, this workspace is remote")
        }
    }

    override suspend fun getSearchResults(query: String): String {
        val ideInfo = this.getIdeInfo()
        if (ideInfo.remoteName == "local") {
            try {
                val command = GeneralCommandLine(
                    ripgrep,
                    "-i",
                    "--ignore-file",
                    ".continueignore",
                    "--ignore-file",
                    ".gitignore",
                    "-C",
                    "2",
                    "--heading",
                    "-e",
                    query,
                    "."
                )

                command.setWorkDirectory(project.basePath)
                return ExecUtil.execAndGetOutput(command).stdout
            } catch (e: Exception) {
                showToast(
                    ToastType.ERROR,
                    "Error executing ripgrep: ${e.message}"
                )
                return "Error: Unable to execute ripgrep command."
            }
        } else {
            throw NotImplementedError("Ripgrep not supported, this workspace is remote")
        }
    }


    override suspend fun subprocess(command: String, cwd: String?): List<Any> {
        val commandList = command.split(" ")
        val builder = ProcessBuilder(commandList)

        if (cwd != null) {
            builder.directory(File(cwd))
        }

        val process = withContext(Dispatchers.IO) {
            builder.start()
        }

        val stdout = process.inputStream.bufferedReader().readText()
        val stderr = process.errorStream.bufferedReader().readText()

        withContext(Dispatchers.IO) {
            process.waitFor()
        }

        return listOf(stdout, stderr)
    }

    override suspend fun getProblems(filepath: String?): List<Problem> {
        val problems = mutableListOf<Problem>()

        ApplicationManager.getApplication().invokeAndWait {
            val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return@invokeAndWait

            val document = editor.document
            val psiFile = PsiDocumentManager.getInstance(project).getPsiFile(document) ?: return@invokeAndWait
            val highlightInfos = DocumentMarkupModel.forDocument(document, project, true)
                .allHighlighters
                .mapNotNull(HighlightInfo::fromRangeHighlighter)

            for (highlightInfo in highlightInfos) {
                if (highlightInfo.severity === HighlightSeverity.ERROR ||
                    highlightInfo.severity === HighlightSeverity.WARNING
                ) {
                    val startOffset = highlightInfo.startOffset
                    val endOffset = highlightInfo.endOffset

                    val startLineNumber = document.getLineNumber(startOffset)
                    val endLineNumber = document.getLineNumber(endOffset)
                    val startCharacter = startOffset - document.getLineStartOffset(startLineNumber)
                    val endCharacter = endOffset - document.getLineStartOffset(endLineNumber)

                    problems.add(
                        Problem(
                            filepath = psiFile.virtualFile?.toUriOrNull() ?: "",
                            range = Range(
                                start = Position(
                                    line = startLineNumber,
                                    character = startCharacter
                                ),
                                end = Position(
                                    line = endLineNumber,
                                    character = endCharacter
                                )
                            ),
                            message = highlightInfo.description
                        )
                    )
                }
            }
        }

        return problems
    }

    override suspend fun getBranch(dir: String): String {
        return withContext(Dispatchers.IO) {
            try {
                val builder = ProcessBuilder("git", "rev-parse", "--abbrev-ref", "HEAD")
                builder.directory(UriUtils.uriToFile(dir))
                val process = builder.start()
                val reader = BufferedReader(InputStreamReader(process.inputStream))
                val output = reader.readLine()
                process.waitFor()
                output ?: "NONE"
            } catch (e: Exception) {
                "NONE"
            }
        }
    }

    override suspend fun getTags(artifactId: String): List<IndexTag> {
        val workspaceDirs = this.getWorkspaceDirs()

        // Collect branches concurrently using Kotlin coroutines
        val branches = withContext(Dispatchers.IO) {
            workspaceDirs.map { dir ->
                async { getBranch(dir) }
            }.map { it.await() }
        }

        // Create the list of IndexTag objects
        return workspaceDirs.mapIndexed { index, directory ->
            IndexTag(artifactId, branches[index], directory)
        }
    }

    override suspend fun getRepoName(dir: String): String? {
        return withContext(Dispatchers.IO) {
            val directory = UriUtils.uriToFile(dir)
            val targetDir = if (directory.isFile) directory.parentFile else directory
            val builder = ProcessBuilder("git", "config", "--get", "remote.origin.url")
            builder.directory(targetDir)
            var output: String?

            try {
                val process = builder.start()
                val reader = BufferedReader(InputStreamReader(process.inputStream))
                output = reader.readLine()
                process.waitFor()
            } catch (e: Exception) {
                output = null
            }

            output
        }
    }

    override suspend fun showToast(type: ToastType, message: String, vararg otherParams: Any): Any {
        return withContext(Dispatchers.Default) {
            val notificationType = when (type) {
                ToastType.ERROR -> NotificationType.ERROR
                ToastType.WARNING -> NotificationType.WARNING
                else -> NotificationType.INFORMATION
            }

            val deferred = CompletableDeferred<String?>()
            val icon = IconLoader.getIcon("/icons/continue.svg", javaClass)

            val notification = NotificationGroupManager.getInstance().getNotificationGroup("Continue")
                .createNotification(message, notificationType).setIcon(icon)

            val buttonTexts = otherParams.filterIsInstance<String>().toTypedArray()
            buttonTexts.forEach { buttonText ->
                notification.addAction(NotificationAction.create(buttonText) { _, _ ->
                    deferred.complete(buttonText)
                    notification.expire()
                })
            }

            launch {
                delay(15000)
                if (!deferred.isCompleted) {
                    deferred.complete(null)
                    notification.expire()
                }
            }

            notification.whenExpired {
                if (!deferred.isCompleted) {
                    deferred.complete(null)
                }
            }

            notification.notify(project)

            deferred.await() ?: ""
        }
    }

    override suspend fun getGitRootPath(dir: String): String? {
        return withContext(Dispatchers.IO) {
            val builder = ProcessBuilder("git", "rev-parse", "--show-toplevel")
            builder.directory(UriUtils.uriToFile(dir))
            val process = builder.start()

            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val output = reader.readLine()
            process.waitFor()
            output
        }
    }

    override suspend fun listDir(dir: String): List<List<Any>> {
        val files = UriUtils.uriToFile(dir).listFiles()?.map {
            listOf(it.name, if (it.isDirectory) FileType.DIRECTORY.value else FileType.FILE.value)
        } ?: emptyList()

        return files
    }

    override suspend fun getFileStats(files: List<String>): Map<String, FileStats> {
        return files.associateWith { file ->
            FileStats(UriUtils.uriToFile(file).lastModified(), UriUtils.uriToFile(file).length())
        }
    }

    override suspend fun gotoDefinition(location: Location): List<RangeInFile> {
        throw NotImplementedError("gotoDefinition not implemented yet")
    }

    override fun onDidChangeActiveTextEditor(callback: (filepath: String) -> Unit) {
        throw NotImplementedError("onDidChangeActiveTextEditor not implemented yet")
    }

    private fun setFileOpen(filepath: String, open: Boolean = true) {
        val file = LocalFileSystem.getInstance().findFileByPath(UriUtils.uriToFile(filepath).path)

        file?.let {
            if (open) {
                ApplicationManager.getApplication().invokeLater {
                    FileEditorManager.getInstance(project).openFile(it, true)
                }
            } else {
                ApplicationManager.getApplication().invokeLater {
                    FileEditorManager.getInstance(project).closeFile(it)
                }
            }
        }
    }

    private fun workspaceDirectories(): Array<String> {
        val dirs = this.continuePluginService.workspacePaths

        if (dirs?.isNotEmpty() == true) {
            return dirs
        }

        return listOfNotNull(project.guessProjectDir()?.toUriOrNull()).toTypedArray()
    }

    override suspend fun rollbackToCheckpoint(checkpointId: String) {
        return withContext(Dispatchers.IO) {
            try {
                ApplicationManager.getApplication().invokeAndWait {
                    try {
                        val targetTimestamp = checkpointId.toLongOrNull()
                        if (targetTimestamp == null) {
                            throw IllegalArgumentException("Invalid timestamp format: $checkpointId")
                        }
                        
                        val projectDir: VirtualFile = project.guessProjectDir()!!

                        val localHistoryImplClass = Class.forName("com.intellij.history.integration.LocalHistoryImpl")
                        val getInstanceImplMethod = localHistoryImplClass.getDeclaredMethod("getInstanceImpl")
                        val localHistoryImpl = getInstanceImplMethod.invoke(null)

                        val gatewayField = localHistoryImplClass.getDeclaredField("gateway")
                        gatewayField.isAccessible = true
                        val gateway = gatewayField.get(localHistoryImpl)

                        val facadeField = localHistoryImplClass.getDeclaredField("facade")
                        facadeField.isAccessible = true
                        val facade = facadeField.get(localHistoryImpl)

                        val dirHistoryModelClass = Class.forName("com.intellij.history.integration.ui.models.DirectoryHistoryDialogModel")
                        val constructor = dirHistoryModelClass.getDeclaredConstructor(
                            Class.forName("com.intellij.openapi.project.Project"),
                            Class.forName("com.intellij.history.integration.IdeaGateway"),
                            Class.forName("com.intellij.history.core.LocalHistoryFacade"),
                            Class.forName("com.intellij.openapi.vfs.VirtualFile")
                        )
                        val dirHistoryModel = constructor.newInstance(project, gateway, facade, projectDir)

                        // 使用 LocalHistoryUtil 获取最适合的历史版本
                        val targetRevision = LocalHistoryUtil.findBestHistoricalRevision(
                            dirHistoryModel as HistoryDialogModel,
                            targetTimestamp
                        )

                        if (targetRevision == null) {
                            throw LocalHistoryException("No suitable revision found for timestamp: $targetTimestamp")
                        }

                        // 获取版本在列表中的索引
                        val revisions = dirHistoryModel.revisions
                        val leftRev = revisions.indexOf(targetRevision)

                        if (leftRev < 0) {
                            throw LocalHistoryException("Couldn't find label revision")
                        } else {
                            try {
                                dirHistoryModel.selectRevisions(-1, leftRev)
                                dirHistoryModel.createReverter().revert()
                            } catch (e: java.lang.Exception) {
                                throw LocalHistoryException(
                                    String.format(
                                        "Couldn't revert %s to local history label.",
                                        projectDir.getName()
                                    ), e
                                )
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                        throw e
                    }
                    FileDocumentManager.getInstance().saveAllDocuments()
                }
            } catch (e: Exception) {
                e.printStackTrace()
                throw RuntimeException("Failed to rollback to checkpoint: ${e.message}")
            }
        }
    }


    override suspend fun revertFile(filepath: String, timestamp: Long) {
        return withContext(Dispatchers.IO) {
            try {
                ApplicationManager.getApplication().invokeAndWait {
                    try {
                        // 获取文件的VirtualFile对象
                        val virtualFile = LocalFileSystem.getInstance()
                            .findFileByPath(UriUtils.uriToFile(filepath).absolutePath)

                        if (virtualFile == null) {
                            throw IllegalArgumentException("File not found: $filepath")
                        }

                        val localHistoryImplClass = Class.forName("com.intellij.history.integration.LocalHistoryImpl")
                        val getInstanceImplMethod = localHistoryImplClass.getDeclaredMethod("getInstanceImpl")
                        val localHistoryImpl = getInstanceImplMethod.invoke(null)

                        val gatewayField = localHistoryImplClass.getDeclaredField("gateway")
                        gatewayField.isAccessible = true
                        val gateway = gatewayField.get(localHistoryImpl)

                        val facadeField = localHistoryImplClass.getDeclaredField("facade")
                        facadeField.isAccessible = true
                        val facade = facadeField.get(localHistoryImpl)

                        val fileHistoryModelClass = Class.forName("com.intellij.history.integration.ui.models.EntireFileHistoryDialogModel")
                        val constructor = fileHistoryModelClass.getDeclaredConstructor(
                            Class.forName("com.intellij.openapi.project.Project"),
                            Class.forName("com.intellij.history.integration.IdeaGateway"),
                            Class.forName("com.intellij.history.core.LocalHistoryFacade"),
                            Class.forName("com.intellij.openapi.vfs.VirtualFile")
                        )
                        val fileHistoryModel = constructor.newInstance(project, gateway, facade, virtualFile)

                        // 获取最适合的历史版本：优先使用指定时间戳之前的版本，如果没有则使用最原始版本
                        val targetRevision = LocalHistoryUtil.findBestHistoricalRevision(fileHistoryModel as HistoryDialogModel, timestamp)
                            ?: throw LocalHistoryException("No revision history found for file: $filepath")

                        // 获取版本在列表中的索引
                        val revisions = fileHistoryModel.revisions
                        val leftRev = revisions.indexOf(targetRevision)

                        if (leftRev < 0) {
                            throw LocalHistoryException("Couldn't find label revision")
                        } else {
                            try {
                                fileHistoryModel.selectRevisions(-1, leftRev)
                                fileHistoryModel.createReverter().revert()
                            } catch (e: java.lang.Exception) {
                                throw LocalHistoryException(
                                    String.format(
                                        "Couldn't revert %s to local history label.",
                                        virtualFile.getName()
                                    ), e
                                )
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                        throw e
                    }
                    FileDocumentManager.getInstance().saveAllDocuments()
                }
            } catch (e: Exception) {
                e.printStackTrace()
                throw RuntimeException("Failed to rollback to checkpoint: ${e.message}")
            }
        }
    }

    /**
     * 显示历史版本与当前版本的diff
     * @param filepath 文件路径
     * @param historicalContent 历史版本内容
     * @param currentContent 当前版本内容
     * @param timestamp 时间戳
     */
    private suspend fun showHistoricalDiff(
        filepath: String,
        historicalContent: String,
        currentContent: String,
        timestamp: Long
    ) {
        withContext(Dispatchers.Main) {
            try {
                // 直接显示diff窗口，不需要创建临时文件
                showHistoricalDiffWindow(
                    historicalContent,
                    currentContent,
                    filepath,
                    timestamp
                )

            } catch (e: Exception) {
                e.printStackTrace()
                throw RuntimeException("Failed to create diff view: ${e.message}", e)
            }
        }
    }

    /**
     * 显示历史版本diff窗口
     */
    private fun showHistoricalDiffWindow(
        historicalContentText: String,
        currentContentText: String,
        originalFilepath: String,
        timestamp: Long
    ) {
        ApplicationManager.getApplication().invokeLater {
            try {
                // 直接从字符串创建DiffContent，无需临时文件
                val historicalContent: DiffContent = DiffContentFactory.getInstance()
                    .create(historicalContentText)
                val currentContent: DiffContent = DiffContentFactory.getInstance()
                    .create(currentContentText)

                // 格式化时间戳为可读格式
                val dateFormat = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
                val formattedTime = dateFormat.format(java.util.Date(timestamp))

                // 创建diff请求
                val diffRequest = SimpleDiffRequest(
                    "变更对比 - $originalFilepath",
                    historicalContent,
                    currentContent,
                    "之前版本 ($formattedTime)",
                    "当前版本"
                )

                // 创建diff面板
                val diffPanel: DiffRequestPanel = DiffManager.getInstance()
                    .createRequestPanel(project, Disposer.newDisposable(), null)
                diffPanel.setRequest(diffRequest)

                // 创建对话框
                val dialog = object : DialogWrapper(project, true, IdeModalityType.MODELESS) {
                    init {
                        init()
                        title = "变更对比 - ${UriUtils.uriToFile(originalFilepath).name}"
                    }

                    override fun createCenterPanel(): JComponent? {
                        return diffPanel.component
                    }

                    override fun createActions(): Array<Action> {
                        // 只显示关闭按钮，因为这是只读的diff查看
                        return arrayOf(cancelAction.apply {
                            putValue(Action.NAME, "关闭")
                        })
                    }

                    override fun doCancelAction() {
                        super.doCancelAction()
                        // 不再需要清理临时文件
                    }
                }

                // 设置对话框大小并显示
                val screenSize = Toolkit.getDefaultToolkit().screenSize
                dialog.setSize((screenSize.width * 0.8).toInt(), (screenSize.height * 0.8).toInt())
                dialog.show()

            } catch (e: Exception) {
                e.printStackTrace()
                throw RuntimeException("Failed to show diff window: ${e.message}", e)
            }
        }
    }



}