package com.github.continuedev.continueintellijextension.utils;

import com.github.continuedev.continueintellijextension.Position;
import com.github.continuedev.continueintellijextension.Range;
import com.github.continuedev.continueintellijextension.RangeInFileWithContents;
import com.intellij.execution.filters.ExceptionWorker;
import com.intellij.lang.Language;
import com.intellij.lang.LanguageUtil;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.TextRange;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.TokenType;
import com.intellij.psi.search.FilenameIndex;
import com.intellij.psi.search.GlobalSearchScope;
import com.intellij.psi.tree.IElementType;
import com.intellij.psi.tree.TokenSet;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;

public class PsiUtils {
    private static final Logger log = Logger.getInstance(PsiUtils.class);
    public static final String IDENTIFIER = "IDENTIFIER";
    public static final String DEFAULT_CLASS_NAME = "DemoClass";
    private static final List<String> commentFlags = Arrays.asList("/", "#", "\"\"\"", "'''", "/*", "*");
    private static final TokenSet INVALID_COMMON_TOKENSET;
    private static final String[] FILE_TYPE_CLASSES;

    public PsiUtils() {
    }

    public static String findErrorLineContent(Project project, Editor editor, int line) {
        return findErrorLineContentByDefault(project, editor, line);
    }

    /**
     * 查找错误行内容并返回 RangeInFileWithContents 对象
     * @param project 当前项目
     * @param editor 当前编辑器
     * @param line 起始行号
     * @return RangeInFileWithContents 对象，包含错误相关的文件路径、范围和内容，如果未找到则返回 null
     */
    @Nullable
    public static RangeInFileWithContents findErrorLineContentAsRange(Project project, Editor editor, int line) {
        while(line < editor.getDocument().getLineCount()) {
            String lineContent = editor.getDocument().getText(new TextRange(editor.getDocument().getLineStartOffset(line), editor.getDocument().getLineEndOffset(line)));
            ExceptionWorker.ParsedLine myInfo = ExceptionWorker.parseExceptionLine(lineContent);
            if (myInfo != null && myInfo.fileName != null) {
                String fileName = myInfo.fileName;
                int documentLine = myInfo.lineNumber;
                String classFullPath = lineContent.substring(myInfo.classFqnRange.getStartOffset(), myInfo.classFqnRange.getEndOffset());
                List<VirtualFile> vFiles = new ArrayList(FilenameIndex.getVirtualFilesByName(project, fileName, GlobalSearchScope.projectScope(project)));
                if (CollectionUtils.isEmpty(vFiles)) {
                    ++line;
                } else {
                    VirtualFile vFile = findMostRelatedVirtualFile(vFiles, classFullPath);
                    log.info("Find stacktrace related vfs " + vFile.getName());

                    try {
                        String content = new String(vFile.contentsToByteArray(true));
                        Language language = LanguageUtil.getFileLanguage(vFile);
                        String languageStr = null;
                        if (language != null) {
                            languageStr = language.getDisplayName().toLowerCase();
                        }

                        // 获取完整的代码块内容
                        String codeBlockContent = getStringBuilder(content, documentLine, languageStr).toString();

                        // 计算代码块的范围
                        String[] contentLines = content.split("\n");
                        int[] blockRange = findCodeBlockRange(contentLines, documentLine, "{", "}", 10);
                        int startLine = blockRange[0];
                        int endLine = blockRange[1];

                        // 构造 Range 对象
                        Range range = new Range(
                            new Position(startLine, 0),
                            new Position(endLine, contentLines[Math.min(endLine, contentLines.length - 1)].length())
                        );

                        // 构造并返回 RangeInFileWithContents 对象
                        return new RangeInFileWithContents(
                            vFile.getUrl(),
                            range,
                            codeBlockContent
                        );
                    } catch (IOException e) {
                        log.error("vFile parse exception. ", e);
                        ++line;
                    }
                }
            } else {
                ++line;
            }
        }

        return null;
    }

    public static String findErrorLineContentByDefault(Project project, Editor editor, int line) {
        while(line < editor.getDocument().getLineCount()) {
            String lineContent = editor.getDocument().getText(new TextRange(editor.getDocument().getLineStartOffset(line), editor.getDocument().getLineEndOffset(line)));
            ExceptionWorker.ParsedLine myInfo = ExceptionWorker.parseExceptionLine(lineContent);
            if (myInfo != null && myInfo.fileName != null) {
                String fileName = myInfo.fileName;
                int documentLine = myInfo.lineNumber;
                String classFullPath = lineContent.substring(myInfo.classFqnRange.getStartOffset(), myInfo.classFqnRange.getEndOffset());
                List<VirtualFile> vFiles = new ArrayList(FilenameIndex.getVirtualFilesByName(project, fileName, GlobalSearchScope.projectScope(project)));
                if (CollectionUtils.isEmpty(vFiles)) {
                    ++line;
                } else {
                    VirtualFile vFile = findMostRelatedVirtualFile(vFiles, classFullPath);
                    log.info("Find stacktrace related vfs " + vFile.getName());

                    String var14;
                    try {
                        String content = new String(vFile.contentsToByteArray(true));
                        Language language = LanguageUtil.getFileLanguage(vFile);
                        String languageStr = null;
                        if (language != null) {
                            languageStr = language.getDisplayName().toLowerCase();
                        }

                        StringBuilder sb = getStringBuilder(content, documentLine, languageStr);
                        var14 = sb.toString();
                    } catch (IOException var18) {
                        IOException e = var18;
                        log.error("vFile parse exception. ", e);
                        continue;
                    } finally {
                        ++line;
                    }

                    return var14;
                }
            } else {
                ++line;
            }
        }

        return null;
    }

    public static VirtualFile findMostRelatedVirtualFile(List<VirtualFile> virtualFiles, String classFullPath) {
        if (!CollectionUtils.isEmpty(virtualFiles) && classFullPath != null) {
            Iterator var2 = virtualFiles.iterator();

            VirtualFile virtualFile;
            String vFileDotPath;
            do {
                if (!var2.hasNext()) {
                    return (VirtualFile)virtualFiles.get(0);
                }

                virtualFile = (VirtualFile)var2.next();
                String vPath = virtualFile.getPath();
                int extPos = vPath.lastIndexOf(".");
                if (extPos > 0) {
                    vPath = vPath.substring(0, extPos);
                }

                vFileDotPath = vPath.replace("/", ".");
            } while(!vFileDotPath.endsWith(classFullPath));

            return virtualFile;
        } else {
            return null;
        }
    }

    public static @NotNull StringBuilder getStringBuilder(String content, int documentLine, String languageStr) {
        String[] contentLines = content.split("\n");
        StringBuilder sb = new StringBuilder();
//        sb.append("```");
//        if (StringUtils.isNotBlank(languageStr)) {
//            sb.append(languageStr);
//        }
//
//        sb.append("\n");
        sb.append(findCompleteCodeBlock(contentLines, documentLine, "{", "}", 10));
//        sb.append("\n");

        return sb;
    }

    public static String findCompleteCodeBlock(String[] contentLines, int documentLine, String blockStartSymbol, String blockEndSymbol, int maxSearchLine) {
        int i = 0;

        boolean found;
        for(found = false; documentLine - i >= 0 && i < maxSearchLine; ++i) {
            String line = contentLines[documentLine - i];
            if (line.endsWith(blockStartSymbol)) {
                found = true;
                break;
            }
        }

        int j = 0;
        if (found) {
            while(documentLine + j <= contentLines.length - 1 && j < maxSearchLine) {
                String line = contentLines[documentLine + j];
                if (line.endsWith(blockEndSymbol)) {
                    break;
                }

                ++j;
            }
        } else {
            j = maxSearchLine;
        }

        StringBuilder sb = new StringBuilder();

        for(int k = Math.max(documentLine - i, 0); k <= Math.min(documentLine + j, contentLines.length - 1); ++k) {
            sb.append(contentLines[k]);
            sb.append("\n");
        }

        if (sb.length() > 1) {
            sb.setLength(sb.length() - 1);
        }

        return sb.toString();
    }

    /**
     * 查找代码块的起始和结束行号
     * @param contentLines 文件内容按行分割的数组
     * @param documentLine 目标行号
     * @param blockStartSymbol 代码块开始符号
     * @param blockEndSymbol 代码块结束符号
     * @param maxSearchLine 最大搜索行数
     * @return 包含起始行号和结束行号的数组 [startLine, endLine]
     */
    public static int[] findCodeBlockRange(String[] contentLines, int documentLine, String blockStartSymbol, String blockEndSymbol, int maxSearchLine) {
        int i = 0;

        boolean found;
        for(found = false; documentLine - i >= 0 && i < maxSearchLine; ++i) {
            String line = contentLines[documentLine - i];
            if (line.endsWith(blockStartSymbol)) {
                found = true;
                break;
            }
        }

        int j = 0;
        if (found) {
            while(documentLine + j <= contentLines.length - 1 && j < maxSearchLine) {
                String line = contentLines[documentLine + j];
                if (line.endsWith(blockEndSymbol)) {
                    break;
                }

                ++j;
            }
        } else {
            j = maxSearchLine;
        }

        int startLine = Math.max(documentLine - i, 0);
        int endLine = Math.min(documentLine + j, contentLines.length - 1);

        return new int[]{startLine, endLine};
    }

    static {
        INVALID_COMMON_TOKENSET = TokenSet.create(new IElementType[]{TokenType.BAD_CHARACTER, TokenType.WHITE_SPACE, TokenType.NEW_LINE_INDENT, TokenType.ERROR_ELEMENT});
        FILE_TYPE_CLASSES = new String[]{"com.intellij.ide.highlighter.JavaFileType", "com.jetbrains.python.PythonFileType", "com.goide.GoFileType"};
    }
}
