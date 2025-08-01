import { ToolImpl } from ".";
import { ProjectAnalyzer } from "../../util/projectAnalyzer.js";

export const projectAnalysisImpl: ToolImpl = async (args, extras) => {
  const { workspaceDir, requirement } = args;

  // 优先从contextData中获取requirementFinal，如果没有则使用参数中的requirement
  let finalRequirement = extras.contextData?.requirementFinal || requirement;
  const userFeedbackContent = extras.contextData?.userFeedbackContent;
  if (userFeedbackContent) {
    finalRequirement += `\n\n用户反馈：${userFeedbackContent}`;
  }

  try {
    const analyzer = new ProjectAnalyzer(extras.ide, extras.llm);

    // 获取工作空间目录
    const workspaceDirs = workspaceDir
      ? [workspaceDir]
      : await extras.ide.getWorkspaceDirs();
    const rootDir = workspaceDirs[0];

    if (!rootDir) {
      throw new Error("No workspace directory found");
    }

    // 分析Maven项目
    const projectStructure = await analyzer.analyzeMavenProject(rootDir);

    if (!projectStructure) {
      return [
        {
          name: "项目分析结果",
          description: "项目分析失败",
          content: `无法分析项目: 在 ${rootDir} 中未找到pom.xml文件,该项目不是maven项目，请调用其他工具进行分析`,
        },
      ];
    }

    // 获取所有叶子模块信息
    const allModules = await analyzer.loadModuleInfo(projectStructure);

    // 构建基本项目信息
    let content = `# Maven项目分析报告\n\n`;
    content += `## 📋 项目基本信息\n`;
    content += `- **项目根目录**: ${rootDir}\n`;
    content += `- **项目类型**: Maven项目\n`;
    content += `- **总模块数**: ${allModules.length}\n\n`;

    // 如果提供了需求，进行模块和文件推荐
    if (finalRequirement) {
      content += `\n## 🎯 基于需求的推荐分析\n\n`;

      try {
        const recommendation = await analyzer.recommendModulesAndFiles(
          finalRequirement,
          projectStructure,
          rootDir,
        );

        content += `### 📋 推荐结果总览\n`;
        content += `- **推荐模块数量**: ${recommendation.recommended_modules.length}\n`;
        content += `- **推荐模块**: ${recommendation.recommended_modules.join(", ")}\n`;

        // 完整版文件推荐
        content += `### 📁 详细文件推荐\n`;
        for (const fileRec of recommendation.recommended_files) {
          content += `#### 🔹 模块: \`${fileRec.module}\`\n`;
          content += `**推荐文件列表**:\n`;
          for (const file of fileRec.files) {
            content += `- \`${file}\`\n`;
          }
        }
      } catch (error) {
        content += `❌ 推荐分析失败: ${error}\n\n`;
      }
    } else {
      // 如果没有需求，也要提供模块列表供用户选择
      content += `\n## 🔧 模块选择配置\n\n`;
      content += `请从以下模块中选择您需要分析的模块：\n\n`;
      content += `### 可选择的模块\n`;
      allModules.forEach((module, index) => {
        content += `${index + 1}. \`${module.name}\`\n`;
      });

      content += `\n### 配置格式示例\n`;
      content += `\`\`\`json\n`;
      content += `{\n`;
      content += `  "${allModules[0]?.name || "module-name"}": ["src/main/java/Example.java"],\n`;
      content += `  "${allModules[1]?.name || "another-module"}": ["src/main/java/Another.java"]\n`;
      content += `}\n`;
      content += `\`\`\`\n\n`;
    }

    return [
      {
        name: "Maven项目分析报告",
        description: "Maven项目的结构分析和模块推荐",
        content,
      },
    ];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 添加日志输出：错误信息
    console.error(`❌ [ProjectAnalysis] 工具调用失败:`);
    console.error(
      `  - 错误类型: ${error instanceof Error ? error.constructor.name : "Unknown"}`,
    );
    console.error(`  - 错误消息: ${errorMessage}`);
    console.error(
      `  - 错误堆栈: ${error instanceof Error ? error.stack : "N/A"}`,
    );

    return [
      {
        name: "项目分析错误",
        description: "项目分析过程中发生错误",
        content: `分析项目时发生错误: ${errorMessage}`,
      },
    ];
  }
};
