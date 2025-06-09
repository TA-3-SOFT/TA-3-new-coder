//
// Source code recreated from a .class file by IntelliJ IDEA
// (powered by FernFlower decompiler)
//

package com.github.continuedev.continueintellijextension.actions;

import com.github.continuedev.continueintellijextension.model.GenerateCommitMsgParam;
import com.github.continuedev.continueintellijextension.utils.ThreadUtil;
import com.github.continuedev.continueintellijextension.services.ContinuePluginService;
import com.intellij.notification.Notification;
import com.intellij.notification.NotificationGroup;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.diff.impl.patch.FilePatch;
import com.intellij.openapi.diff.impl.patch.IdeaTextPatchBuilder;
import com.intellij.openapi.diff.impl.patch.PatchHunk;
import com.intellij.openapi.diff.impl.patch.TextFilePatch;
import com.intellij.openapi.diff.impl.patch.UnifiedDiffWriter;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.IconLoader;
import com.intellij.openapi.vcs.FilePath;
import com.intellij.openapi.vcs.VcsDataKeys;
import com.intellij.openapi.vcs.VcsException;
import com.intellij.openapi.vcs.changes.Change;
import com.intellij.openapi.vcs.changes.CommitContext;
import com.intellij.openapi.vcs.changes.ContentRevision;
import com.intellij.openapi.vcs.changes.CurrentContentRevision;
import com.intellij.openapi.vcs.ui.CommitMessage;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.project.ProjectKt;
import com.intellij.vcs.commit.AbstractCommitWorkflowHandler;
import com.intellij.vcs.log.impl.TimedVcsCommitImpl;
import git4idea.GitCommit;
import git4idea.history.GitHistoryUtils;
import git4idea.repo.GitRepository;
import git4idea.repo.GitRepositoryManager;

import java.io.IOException;
import java.io.StringWriter;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;
import javax.swing.*;


import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.BooleanUtils;
import org.apache.commons.lang3.StringUtils;
import org.jetbrains.annotations.NotNull;

public class CommitMessageGenerationAction extends AnAction {
    private static Logger log = Logger.getInstance(CommitMessageGenerationAction.class);
    private static final ScheduledExecutorService SCHEDULED_EXECUTOR = Executors.newSingleThreadScheduledExecutor();
    private static final Long MAX_PATCH_LEN = 70000L;
    private static final int MAX_FILE = 50;
    private static final int COSY_GENERATE_TIMEOUT = 20;
    private static final int MAX_SINGLE_LINE_LEN = 300;
    public static final Map<String, Project> COMMIT_MESSAGE_REQUEST_TO_PROJECT = new ConcurrentHashMap();
    public static final Map<String, String> PROJECT_TO_COMMIT_MESSAGE_REQUEST = new ConcurrentHashMap();
    public static final Map<String, CommitMessageInstance> REQUEST_COMMIT_MESSAGE = new ConcurrentHashMap();

    private static Icon logoIcon = IconLoader.getIcon("/icons/continue_20.svg", CommitMessageGenerationAction.class);
    private static Icon stopIcon = IconLoader.getIcon("/icons/stop_grey.svg", CommitMessageGenerationAction.class);

    private static final NotificationGroup NOTIFICATION_GROUP = NotificationGroupManager.getInstance().getNotificationGroup("Continue");

    public CommitMessageGenerationAction() {
        super("生成提交信息", "", logoIcon);
    }


    public void actionPerformed(@NotNull AnActionEvent anActionEvent) {
        if (stopIcon.equals(anActionEvent.getPresentation().getIcon())) {
            this.stopAnswer(anActionEvent.getProject(), anActionEvent);
        } else {
            anActionEvent.getPresentation().setText("停止");
            anActionEvent.getPresentation().setIcon(stopIcon);
            CommitMessage commitMessage = (CommitMessage) VcsDataKeys.COMMIT_MESSAGE_CONTROL.getData(anActionEvent.getDataContext());
            this.chatAsk(anActionEvent.getProject(), commitMessage, anActionEvent);
        }
    }

    private List<String> getDiff(AnActionEvent anActionEvent) {
        Object workflowHandler = anActionEvent.getDataContext().getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER);
        if (workflowHandler == null) {
            return new ArrayList();
        } else {
            List<Change> changeList = new ArrayList();
            if (workflowHandler instanceof AbstractCommitWorkflowHandler) {
                List<Change> includedChanges = ((AbstractCommitWorkflowHandler) workflowHandler).getUi().getIncludedChanges();
                if (CollectionUtils.isNotEmpty(includedChanges)) {
                    changeList.addAll(includedChanges);
                }

                List<FilePath> filePaths = ((AbstractCommitWorkflowHandler) anActionEvent.getDataContext().getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER)).getUi().getIncludedUnversionedFiles();
                log.debug("filePaths is " + filePaths + ",size is " + filePaths.size());
                if (CollectionUtils.isNotEmpty(filePaths)) {
                    for (FilePath filePath : filePaths) {
                        Change change = new Change((ContentRevision) null, new CurrentContentRevision(filePath));
                        changeList.add(change);
                    }
                }

                List<String> totalCommitLines = new ArrayList<>();
                AtomicLong totalLength = new AtomicLong(0L);

                for (Change change : changeList) {
                    try {
                        Boolean isValid = this.checkIfValidChange(change);
                        if (BooleanUtils.isTrue(isValid)) {
                            List<FilePatch> patches = IdeaTextPatchBuilder.buildPatch(anActionEvent.getProject(), Arrays.asList(change), Path.of(anActionEvent.getProject().getBasePath()), false, false);
                            if (CollectionUtils.isEmpty(patches)) {
                                String fileName = change.getAfterRevision() != null ? change.getAfterRevision().getFile().getName() : (change.getBeforeRevision() != null ? change.getBeforeRevision().getFile().getName() : "");
                                if (!StringUtils.isBlank(fileName)) {
                                    totalCommitLines.add(fileName + " change mod");
                                    if (totalLength.get() >= MAX_PATCH_LEN || totalCommitLines.size() >= 50) {
                                        break;
                                    }
                                }
                            } else {
                                Boolean isValidChange = this.checkIfChangeLengthTooLarge(patches, totalLength);
                                if (BooleanUtils.isTrue(isValidChange)) {
                                    StringWriter writer = new StringWriter();

                                    try {
                                        UnifiedDiffWriter.write(anActionEvent.getProject(), ProjectKt.getStateStore(anActionEvent.getProject()).getProjectBasePath(), patches, writer, "\n", (CommitContext) null, List.of());
                                        if (StringUtils.isNotBlank(writer.toString())) {
                                            totalCommitLines.add(writer.toString());
                                        }

                                        if (totalCommitLines.size() >= 50 || totalLength.get() >= MAX_PATCH_LEN) {
                                            break;
                                        }
                                    } finally {
                                        writer.close();
                                    }
                                }
                            }
                        }
                    } catch (VcsException e) {
                        log.warn("get changeList error", e);
                    } catch (IOException e) {
                        log.warn("get changeList error", e);
                    }
                }

                return totalCommitLines;
            } else {
                return new ArrayList();
            }
        }
    }

    private Boolean checkIfValidChange(Change change) {
        Boolean isBinary = change.getAfterRevision() != null ? change.getAfterRevision().getFile().getFileType().isBinary() : change.getBeforeRevision().getFile().getFileType().isBinary();
        if (isBinary) {
            return false;
        } else {
            ContentRevision contentRevision = change.getAfterRevision() != null ? change.getAfterRevision() : change.getBeforeRevision();
            if (contentRevision == null) {
                return false;
            } else {
                String content = null;

                try {
                    content = contentRevision.getContent();
                } catch (VcsException e) {
                    log.warn("get content error", e);
                }

                return StringUtils.isNotBlank(content) && !content.contains("\n") && !content.contains("\r") && content.length() > 300 ? false : true;
            }
        }
    }

    private Boolean checkIfChangeLengthTooLarge(List<FilePatch> patches, AtomicLong totalLength) {
        Long lengthOfChange = 0L;

        for (FilePatch patch : patches) {
            if (!(patch instanceof TextFilePatch)) {
                return false;
            }

            List<PatchHunk> patchHunks = ((TextFilePatch) patch).getHunks();
            if (CollectionUtils.isEmpty(patchHunks)) {
                return false;
            }

            if (patchHunks.size() == 1) {
                PatchHunk patchHunk = patchHunks.get(0);
                if (patchHunk.getLines().size() == 1 && patchHunk.getText().length() > 300) {
                    return false;
                }
            }

            for (PatchHunk patchHunk : patchHunks) {
                lengthOfChange = lengthOfChange + (long) patchHunk.getText().length();
            }
        }

        if (totalLength.get() + lengthOfChange > MAX_PATCH_LEN) {
            return false;
        } else {
            totalLength.addAndGet(lengthOfChange);
            return true;
        }
    }

    private void chatAsk(final Project project, final CommitMessage commitMessage, final AnActionEvent anActionEvent) {
        final String requestId = UUID.randomUUID().toString();
        this.initGlobalVariable(project, requestId, commitMessage, anActionEvent);
//        TelemetryService.getInstance().telemetryGenerateCommitMsg(project, TrackEventTypeEnum.COMMIT_MESSAGE_TRIGGER, requestId);
        (new Task.Backgroundable(project, "生成中...") {
            private boolean success = false;

            public void run(@NotNull ProgressIndicator indicator) {
                try {
                    CommitMessageGenerationAction.this.doChatAsk(project, requestId, commitMessage, anActionEvent);
                } catch (Exception e) {
                    CommitMessageGenerationAction.this.afterGenerateCommitMsg(anActionEvent, project, requestId);
                    CommitMessageGenerationAction.log.warn("generate commit message, errorMsg is " + e.getMessage());
                }

                this.success = true;
            }

            public void onFinished() {
                if (this.success) {
                }

            }
        }).queue();
        this.scheduleChatTimeout(requestId, project, anActionEvent);
    }

    private void doChatAsk(Project project, String requestId, CommitMessage commitMessage, AnActionEvent anActionEvent) {

        SwingUtilities.invokeLater(() -> {
            commitMessage.setText("");
            anActionEvent.getPresentation().setIcon(stopIcon);
            anActionEvent.getPresentation().setText("停止");
        });
        GenerateCommitMsgParam generateCommitMsgParam = new GenerateCommitMsgParam();
        generateCommitMsgParam.setRequestId(requestId);
        generateCommitMsgParam.setStream(true);
        List<String> commitMessages = this.getLatestCommitMessages(anActionEvent.getProject());
        ApplicationManager.getApplication().invokeLater(() -> {
            List<String> diffList = this.getDiff(anActionEvent);
            if (CollectionUtils.isEmpty(diffList)) {
//                NotificationFactory.showWarnNotification(project, "没有文件变更，或所选择的文件不符合条件");
                Notification notification = NOTIFICATION_GROUP.createNotification("没有文件变更，或所选择的文件不符合条件", NotificationType.INFORMATION);
                notification.setIcon(logoIcon);
                notification.notify(project);
                this.afterGenerateCommitMsg(anActionEvent, project, requestId);
            } else {
                generateCommitMsgParam.setCommitMessages(commitMessages);
                generateCommitMsgParam.setCodeDiffs(diffList);
                String preferredLanguage = Locale.CHINESE.getLanguage();
                generateCommitMsgParam.setPreferredLanguage(preferredLanguage);

                // 使用 Continue 核心服务生成提交信息
                this.generateCommitMessageWithContinue(project, requestId, diffList, commitMessage, anActionEvent);
            }
        }, ModalityState.defaultModalityState());


    }

    private void initGlobalVariable(Project project, String requestId, CommitMessage commitMessage, AnActionEvent anActionEvent) {
        String curRequestId = (String) PROJECT_TO_COMMIT_MESSAGE_REQUEST.get(project.getName());
        if (curRequestId != null) {
            REQUEST_COMMIT_MESSAGE.remove(curRequestId);
            COMMIT_MESSAGE_REQUEST_TO_PROJECT.remove(curRequestId);
            PROJECT_TO_COMMIT_MESSAGE_REQUEST.remove(project.getName());
        }

        COMMIT_MESSAGE_REQUEST_TO_PROJECT.put(requestId, project);
        PROJECT_TO_COMMIT_MESSAGE_REQUEST.put(project.getName(), requestId);
        CommitMessageInstance commitMessageInstance = new CommitMessageInstance(commitMessage, anActionEvent);
        REQUEST_COMMIT_MESSAGE.put(requestId, commitMessageInstance);
    }

    private void scheduleChatTimeout(String requestId, Project project, AnActionEvent anActionEvent) {
        SCHEDULED_EXECUTOR.schedule(() -> {
            if (COMMIT_MESSAGE_REQUEST_TO_PROJECT.get(requestId) != null) {
                CommitMessageInstance commitMessageInstance = (CommitMessageInstance) REQUEST_COMMIT_MESSAGE.get(requestId);
                if (commitMessageInstance != null) {
                    CommitMessage commitMessage = commitMessageInstance.getCommitMessage();
                    if (commitMessage != null && StringUtils.isBlank(commitMessage.getText())) {
//                        NotificationFactory.showWarnNotification(project, I18NConstant.CHAT_ANSWER_TIMEOUT);
                        Notification notification = NOTIFICATION_GROUP.createNotification("抱歉，请求超时，请重试。", NotificationType.INFORMATION);
                        notification.setIcon(logoIcon);
                        notification.notify(project);
                        this.afterGenerateCommitMsg(anActionEvent, project, requestId);
                    }

                }
            }
        }, 20L, TimeUnit.SECONDS);
    }

    private void stopAnswer(Project project, AnActionEvent anActionEvent) {
        anActionEvent.getPresentation().setText("生成提交信息");
        anActionEvent.getPresentation().setIcon(logoIcon);
        String requestId = PROJECT_TO_COMMIT_MESSAGE_REQUEST.get(project.getName());
        if (requestId != null) {
            // 尝试取消 Continue 核心的请求
            try {
                ContinuePluginService continuePluginService = project.getService(ContinuePluginService.class);
                if (continuePluginService != null && continuePluginService.getCoreMessenger() != null) {
                    Map<String, Object> abortData = new HashMap<>();
                    abortData.put("requestId", requestId);
                    continuePluginService.getCoreMessenger().request("abort", abortData, null, (response) -> {
                        // 忽略响应
                        return null;
                    });
                }
            } catch (Exception e) {
                log.warn("Error aborting Continue request: " + e.getMessage());
            }

            this.afterGenerateCommitMsg(anActionEvent, project, requestId);
        }
    }

    private void afterGenerateCommitMsg(AnActionEvent anActionEvent, Project project, String requestId) {
        COMMIT_MESSAGE_REQUEST_TO_PROJECT.remove(requestId);
        REQUEST_COMMIT_MESSAGE.remove(requestId);
        PROJECT_TO_COMMIT_MESSAGE_REQUEST.remove(project.getName());
        if (anActionEvent != null) {
            SwingUtilities.invokeLater(() -> {
                anActionEvent.getPresentation().setText("生成提交信息");
                anActionEvent.getPresentation().setIcon(logoIcon);
            });
        }

    }

    private List<String> getLatestCommitMessages(Project project) {
        List<String> commitMessageList = new ArrayList();
        VirtualFile projectFile = project.getProjectFile();
        if (projectFile == null) {
            VirtualFile[] selectedFiles = FileEditorManager.getInstance(project).getSelectedFiles();
            if (selectedFiles != null && selectedFiles.length > 0) {
                projectFile = selectedFiles[0];
            }
        }

        GitRepository repository = null;
        if (projectFile != null) {
            repository = GitRepositoryManager.getInstance(project).getRepositoryForFile(projectFile);
        } else {
            List<GitRepository> repositories = GitRepositoryManager.getInstance(project).getRepositories();
            if (CollectionUtils.isNotEmpty(repositories)) {
                repository = repositories.get(0);
            }
        }

        if (repository == null) {
            return commitMessageList;
        } else {
            VirtualFile root = repository.getRoot();
            if (root == null) {
                return commitMessageList;
            } else {
                try {
                    List<GitCommit> commits = GitHistoryUtils.history(project, root, new String[]{"--max-count=3"});
                    if (CollectionUtils.isEmpty(commits)) {
                        return commitMessageList;
                    }

                    for (GitCommit commit : commits.stream().sorted(Comparator.comparing(TimedVcsCommitImpl::getTimestamp).reversed()).limit(3L).collect(Collectors.toList())) {
                        String commitMessage = commit.getFullMessage();
                        commitMessageList.add(commitMessage);
                    }
                } catch (VcsException e) {
                    log.warn("getLatestCommitMessages error, errorMsg is " + e.getMessage());
                }

                return commitMessageList;
            }
        }
    }

    private void generateCommitMessageWithContinue(Project project, String requestId, List<String> diffList, CommitMessage commitMessage, AnActionEvent anActionEvent) {
        ThreadUtil.execute(() -> {
            try {
                ContinuePluginService continuePluginService = project.getService(ContinuePluginService.class);
                if (continuePluginService == null || continuePluginService.getCoreMessenger() == null) {
                    log.warn("Continue plugin service or core messenger not available");
                    Notification notification = NOTIFICATION_GROUP.createNotification("Continue 服务不可用，请确保插件已正确初始化", NotificationType.WARNING);
                    notification.setIcon(logoIcon);
                    notification.notify(project);
                    this.afterGenerateCommitMsg(anActionEvent, project, requestId);
                    return;
                }

                // 构建提交信息生成的提示词
                String diffContent = String.join("\n", diffList);
                String prompt = diffContent + "\n\n你是一个用于在代码版本控制中生成简明的提交信息的工具，你的任务是根据上面的的内容生成概括性，且规范标准的提交信息。\n" +
                        "输出要求：\n" +
                        "1. 根据提供的git信息，分析出要提交的信息\n" +
                        "2. 使用代码规范提交用词作为输出开头，如feat、fix、refactor等\n" +
                        "3. 多个文件都提交时，总结归纳本次提交的信息，可分为几点来描述，如1. 2. 3. 等，字数不要超过100字\n" +
                        "4. 请使用中文，直接输出字符串，不要json格式\n" +
                        "5. 不要输出文件的全路径，只要文件名\n" +
                        "6. 不要输出成代码格式或json格式";

                // 创建聊天消息
                Map<String, Object> chatMessage = new HashMap<>();
                chatMessage.put("role", "user");
                chatMessage.put("content", prompt);

                List<Map<String, Object>> messages = new ArrayList<>();
                messages.add(chatMessage);

                // 创建完成选项
                Map<String, Object> completionOptions = new HashMap<>();
                completionOptions.put("stream", true);

                Map<String, Object> requestData = new HashMap<>();
                requestData.put("messages", messages);
                requestData.put("completionOptions", completionOptions);
                requestData.put("title", "生成提交信息");

                // 发送请求到 Continue 核心
                continuePluginService.getCoreMessenger().request("llm/streamChat", requestData, requestId, (response) -> {
                    this.handleContinueResponse(response, requestId, commitMessage, anActionEvent, project);
                    return null;
                });

            } catch (Exception e) {
                log.warn("Error generating commit message with Continue: " + e.getMessage(), e);
                Notification notification = NOTIFICATION_GROUP.createNotification("生成提交信息时发生错误：" + e.getMessage(), NotificationType.ERROR);
                notification.setIcon(logoIcon);
                notification.notify(project);
                this.afterGenerateCommitMsg(anActionEvent, project, requestId);
            }
        });
    }

    private void handleContinueResponse(Object response, String requestId, CommitMessage commitMessage, AnActionEvent anActionEvent, Project project) {
        try {
            if (response instanceof Map) {
                Map<String, Object> responseMap = (Map<String, Object>) response;
                Object content = responseMap.get("content");

                if (content instanceof Map) {
                    Map<String, Object> contentMap = (Map<String, Object>) content;

                    // 检查是否是 ChatMessage 格式
                    Object role = contentMap.get("role");
                    Object messageContent = contentMap.get("content");

                    if ("assistant".equals(role) && messageContent instanceof String) {
                        String text = (String) messageContent;
                        SwingUtilities.invokeLater(() -> {
                            String currentText = commitMessage.getText();
                            commitMessage.setText(currentText + text);
                        });
                    }
                }

                // 检查是否完成 - 查看状态字段
                Object status = responseMap.get("status");
                Object done = responseMap.get("done");

                if ("success".equals(status) && Boolean.TRUE.equals(done)) {
                    // 生成完成
                    SwingUtilities.invokeLater(() -> {
                        this.afterGenerateCommitMsg(anActionEvent, project, requestId);
                    });
                }
            }
        } catch (Exception e) {
            log.warn("Error handling Continue response: " + e.getMessage(), e);
            SwingUtilities.invokeLater(() -> {
                this.afterGenerateCommitMsg(anActionEvent, project, requestId);
            });
        }
    }

    public class CommitMessageInstance {
        private CommitMessage commitMessage;
        private AnActionEvent anActionEvent;

        public CommitMessageInstance() {
        }

        public CommitMessageInstance(CommitMessage commitMessage, AnActionEvent anActionEvent) {
            this.commitMessage = commitMessage;
            this.anActionEvent = anActionEvent;
        }


        public CommitMessage getCommitMessage() {
            return this.commitMessage;
        }


        public AnActionEvent getAnActionEvent() {
            return this.anActionEvent;
        }


        public void setCommitMessage(CommitMessage commitMessage) {
            this.commitMessage = commitMessage;
        }


        public void setAnActionEvent(AnActionEvent anActionEvent) {
            this.anActionEvent = anActionEvent;
        }
    }
}
