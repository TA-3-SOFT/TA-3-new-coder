//
// Source code recreated from a .class file by IntelliJ IDEA
// (powered by FernFlower decompiler)
//

package com.github.continuedev.continueintellijextension.actions;

import com.github.continuedev.continueintellijextension.model.GenerateCommitMsgParam;
import com.github.continuedev.continueintellijextension.utils.ThreadUtil;
import com.intellij.notification.Notification;
import com.intellij.notification.NotificationGroup;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.UpdateInBackground;
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

public class CommitMessageGenerationAction extends AnAction implements UpdateInBackground {
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
                ThreadUtil.execute(() -> {
//                    GenerateCommitMsgResult generateCommitMsgResult = Cosy.INSTANCE.getLanguageService(project).generateCommitMsg(generateCommitMsgParam, 10000L);
//                    if (generateCommitMsgResult != null && BooleanUtils.isTrue(generateCommitMsgResult.getIsSuccess())) {
//                        log.info(String.format("generate commit message result = %s", generateCommitMsgResult.getIsSuccess()));
//                    } else {
//                        log.warn("generate commit message error, requestId is " + requestId + ", result is " + generateCommitMsgResult);
//                        this.afterGenerateCommitMsg(anActionEvent, project, requestId);
//                    }
                });
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

//    public Boolean updateAnswer(GenerateCommitMsgAnswerParams generateCommitMsgAnswerParams) {
//        if (generateCommitMsgAnswerParams != null && generateCommitMsgAnswerParams.getText() != null) {
//            ThreadUtil.execute(() -> {
//                CommitMessageInstance commitMessageInstance = (CommitMessageInstance) REQUEST_COMMIT_MESSAGE.get(generateCommitMsgAnswerParams.getRequestId());
//                if (commitMessageInstance == null) {
//                    log.debug("commit message commitMessageInstance null.");
//                } else {
//                    Project project = (Project) COMMIT_MESSAGE_REQUEST_TO_PROJECT.get(generateCommitMsgAnswerParams.getRequestId());
//                    CommitMessage commitMessage = commitMessageInstance.getCommitMessage();
//                    if (project != null && commitMessage != null) {
//                        try {
//                            SwingUtilities.invokeAndWait(() -> {
//                                String var10001 = commitMessage.getText();
//                                commitMessage.setText(var10001 + generateCommitMsgAnswerParams.getText());
//                            });
//                        } catch (InterruptedException e) {
//                            throw new RuntimeException(e);
//                        } catch (InvocationTargetException e) {
//                            throw new RuntimeException(e);
//                        }
//                    } else {
//                        log.debug("Cannot find project in commit message processor by request_id " + generateCommitMsgAnswerParams.getRequestId());
//                    }
//                }
//            });
//            return true;
//        } else {
//            log.warn("commit message answer params contain null.");
//            return false;
//        }
//    }

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
//            TelemetryService.getInstance().telemetryGenerateCommitMsg(project, TrackEventTypeEnum.COMMIT_MESSAGE_STOP, requestId);
            this.afterGenerateCommitMsg(anActionEvent, project, requestId);
        }
    }

//    public Boolean finishAnswer(GenerateCommitMsgFinishParams generateCommitMsgFinishParams) {
//        Project project = (Project) COMMIT_MESSAGE_REQUEST_TO_PROJECT.get(generateCommitMsgFinishParams.getRequestId());
//        if (project == null) {
//            log.debug("commit message project null.");
//            return false;
//        } else {
//            CommitMessageInstance commitMessageInstance = (CommitMessageInstance) REQUEST_COMMIT_MESSAGE.get(generateCommitMsgFinishParams.getRequestId());
//            if (commitMessageInstance == null) {
//                log.debug("commit message commitMessageInstance null.");
//                return false;
//            } else {
//                AnActionEvent anActionEvent = commitMessageInstance.getAnActionEvent();
//                if (generateCommitMsgFinishParams.getStatusCode() == 408) {
//                    NotificationFactory.showWarnNotification(project, I18NConstant.CHAT_ANSWER_TIMEOUT);
//                } else if (generateCommitMsgFinishParams.getStatusCode() == 403) {
//                    String errorMsg = ErrorMessageHandler.convertErrorMessage(project, generateCommitMsgFinishParams.getRequestId(), generateCommitMsgFinishParams.getReason(), ScenarioConstants.SCENARIO_GENERATE_COMMIT_MSG);
//                    NotificationFactory.showWarnNotification(project, errorMsg);
//                }
//
//                this.afterGenerateCommitMsg(anActionEvent, project, generateCommitMsgFinishParams.getRequestId());
//                return true;
//            }
//        }
//    }

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
            repository = (GitRepository) GitRepositoryManager.getInstance(project).getRepositoryForFile(projectFile);
        } else {
            List<GitRepository> repositories = GitRepositoryManager.getInstance(project).getRepositories();
            if (CollectionUtils.isNotEmpty(repositories)) {
                repository = (GitRepository) repositories.get(0);
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
