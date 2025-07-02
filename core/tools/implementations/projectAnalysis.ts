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

    // let content = `# Maven项目分析报告\n\n`;
    // content += `**项目根路径**: ${rootDir}\n\n`;
    //
    // // 展平模块信息
    // const flatModules = analyzer.flattenModules(projectStructure.modules);
    // content += `## 叶子模块列表 (共${flatModules.length}个)\n\n`;
    //
    // for (const module of flatModules) {
    //   content += `### ${module.name}\n`;
    //   if (module.description && module.description !== '未找到README文件') {
    //     const shortDesc = module.description.substring(0, 200);
    //     content += `**描述**: ${shortDesc}${module.description.length > 200 ? '...' : ''}\n\n`;
    //   } else {
    //     content += `**描述**: 无描述\n\n`;
    //   }
    // }

    let content = ``;

    // 如果提供了需求，进行模块和文件推荐
    if (finalRequirement) {
      content += `## 基于需求的推荐分析\n\n`;
      // content += `**用户需求**: ${finalRequirement}\n\n`;

      try {
        const recommendation = await analyzer.recommendModulesAndFiles(
          finalRequirement,
          projectStructure,
          rootDir,
        );

        // content += `### 推荐的模块\n`;
        // content += `**推荐模块**: ${recommendation.recommended_modules.join(", ")}\n`;
        // content += `**推荐理由**: ${recommendation.module_reasoning}\n\n`;

        // content += `### 推荐的文件\n`;
        for (const fileRec of recommendation.recommended_files) {
          content += `#### 模块: ${fileRec.module}\n`;
          content += `**推荐文件**:\n`;
          for (const file of fileRec.files) {
            content += `- ${file}\n`;
          }
          content += `**推荐理由**: ${fileRec.file_reasoning}\n\n`;
        }
      } catch (error) {
        content += `推荐分析失败: ${error}\n\n`;
      }
    }

    console.log(content);

    return [
      {
        name: "Maven项目分析报告",
        description: "Maven项目的结构分析和模块推荐",
        content,
      },
    ];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "项目分析错误",
        description: "项目分析过程中发生错误",
        content: `分析项目时发生错误: ${errorMessage}`,
      },
    ];
  }
};
