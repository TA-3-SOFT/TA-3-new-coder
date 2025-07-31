//
// Source code recreated from a .class file by IntelliJ IDEA
// (powered by FernFlower decompiler)
//

package com.github.continuedev.continueintellijextension.filter;

import com.github.continuedev.continueintellijextension.HighlightedCodePayload;
import com.github.continuedev.continueintellijextension.RangeInFileWithContents;
import com.github.continuedev.continueintellijextension.actions.UtilsKt;
import com.github.continuedev.continueintellijextension.services.ContinuePluginService;
import com.github.continuedev.continueintellijextension.utils.PsiUtils;
import static com.github.continuedev.continueintellijextension.utils.StatKt.incrementFeatureCount;
import com.intellij.codeInsight.hints.presentation.InputHandler;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.EditorCustomElementRenderer;
import com.intellij.openapi.editor.Inlay;
import com.intellij.openapi.editor.colors.EditorColors;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.impl.EditorImpl;
import com.intellij.openapi.editor.markup.TextAttributes;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.IconLoader;
import com.intellij.openapi.util.TextRange;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseEvent;
import java.util.Objects;
import java.util.UUID;

public class TaAiPresentation implements EditorCustomElementRenderer, InputHandler {
    private final Editor editor;
    private final Project myProject;
    private final int startOffset;
    private static final Icon EX_ICON = IconLoader.getIcon("/icons/ta3logo_ex.svg", TaAiPresentation.class);

    public TaAiPresentation(Editor editor, Project project, int starOffset) {
        this.editor = editor;
        this.myProject = project;
        this.startOffset = starOffset;
    }

    private String getErrorStacktrace(Document document, int startOffset, int line) {
        String errorHeader = document.getText(new TextRange(startOffset, document.getLineEndOffset(line)));
        StringBuilder sb = new StringBuilder(errorHeader);
        ++line;

        while (line < document.getLineCount()) {
            String lineContent = document.getText(new TextRange(document.getLineStartOffset(line), document.getLineEndOffset(line)));
            if (!lineContent.trim().startsWith("at ") && !lineContent.trim().startsWith("Caused by") && !lineContent.trim().startsWith("...")) {
                break;
            }

            sb.append("\n");
            sb.append(lineContent);
            ++line;
        }

        return sb.toString();
    }

    public void mouseClicked(@NotNull MouseEvent mouseEvent, @NotNull Point point) {
        incrementFeatureCount(this.myProject, "exceptionAnalysis");

        int line = this.editor.getDocument().getLineNumber(this.startOffset);

        // 获取错误行内容
        RangeInFileWithContents errorLineContentAsRange = PsiUtils.findErrorLineContentAsRange(this.myProject, this.editor, line);
        // 获取错误堆栈信息
        String errorInformation = this.getErrorStacktrace(this.editor.getDocument(), this.startOffset, line);
        String errorPrompt = String.format("修复报错:\n%s\n\n", errorInformation);

        ContinuePluginService continuePluginService = UtilsKt.getContinuePluginService(this.myProject);
        // 聚焦到Continue输入框
        Objects.requireNonNull(Objects.requireNonNull(continuePluginService).getContinuePluginWindow()).getContent().getComponents()[0].requestFocus();
        continuePluginService.sendToWebview("focusContinueInputWithoutClear", null, UUID.randomUUID().toString());

        continuePluginService.sendToWebview(
                "highlightedCode",
                new HighlightedCodePayload(Objects.requireNonNull(errorLineContentAsRange), errorPrompt, true),
                UUID.randomUUID().toString()
        );

    }

    public void mouseExited() {
        ((EditorImpl) this.editor).setCustomCursor(this, Cursor.getPredefinedCursor(2));
    }

    public void mouseMoved(@NotNull MouseEvent mouseEvent, @NotNull Point point) {
        ((EditorImpl) this.editor).setCustomCursor(this, Cursor.getPredefinedCursor(12));
    }

    public int calcWidthInPixels(@NotNull Inlay inlay) {
        return EX_ICON.getIconWidth();
    }

    public int calcHeightInPixels(@NotNull Inlay inlay) {
        return EX_ICON.getIconHeight();
    }

    public void paint(@NotNull Inlay inlay, @NotNull Graphics g, @NotNull Rectangle r, @NotNull TextAttributes textAttributes) {
        if (r == null) {
            return;
        }

        if (textAttributes == null) {
            return;
        }

        Color color = EditorColorsManager.getInstance().getGlobalScheme().getColor(EditorColors.READONLY_FRAGMENT_BACKGROUND_COLOR);
        Icon consoleIcon = EX_ICON;
        int curX = r.x + r.width / 2 - consoleIcon.getIconWidth() / 2;
        int curY = r.y + r.height / 2 - consoleIcon.getIconHeight() / 2;
        if (curX >= 0 && curY >= 0) {
            consoleIcon.paintIcon(inlay.getEditor().getComponent(), g, curX, curY);
        }
    }
}
