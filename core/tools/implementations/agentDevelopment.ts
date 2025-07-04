import { ToolImpl } from ".";
import { AgentDevelopmentClient } from "../../util/agentDevelopmentClient.js";

export const agentDevelopmentImpl: ToolImpl = async (args, extras) => {
  try {
    let userRequirement = extras.contextData?.requirementFinal;
    const userFeedbackContent: any = extras.contextData?.userFeedbackContent;
    if (userFeedbackContent) {
      userRequirement += `\n\n用户反馈:${userFeedbackContent}`;
    }
    // 验证参数
    if (!userRequirement || typeof userRequirement !== "string") {
      return [
        {
          name: "Agent开发工具错误",
          description: "参数验证失败",
          content: "userRequirement 参数必须是非空字符串",
        },
      ];
    }

    // 获取嵌入提供者（从配置中）
    const embeddingsProvider = extras.config?.selectedModelByRole?.embed || undefined;

    // 创建开发客户端，使用系统LLM和嵌入提供者（如果可用）
    const client = new AgentDevelopmentClient(
      extras.fetch,
      extras.llm,
      embeddingsProvider,
    );

    // 分析开发需求，获取相关的工具类和开发规范
    const analysisResult =
      await client.analyzeDevelopmentRequirements(userRequirement);

    // 构建返回内容
    let content = `# Ta+3 404框架开发指南\n\n`;
    content += `## 用户需求\n${userRequirement}\n\n`;

    // 尝试使用向量匹配选择具体方法
    let methodsResult = null;
    if (embeddingsProvider) {
      try {
        methodsResult = await client.analyzeUtilClassMethods();
        console.log(
          "向量匹配成功，找到方法:",
          methodsResult.selectedMethods.length,
        );
      } catch (error) {
        console.warn("向量匹配失败，将使用传统方法:", error);
        methodsResult = null;
      }
    } else {
      console.log("未配置嵌入提供者，使用传统方法显示工具类");
    }

    // 添加工具类方法信息
    if (methodsResult && methodsResult.selectedMethods.length > 0) {
      // 使用向量匹配结果
      content += `## 推荐使用的工具类方法（基于向量匹配）\n\n`;
      content += `> 以下方法是通过向量匹配技术，根据需求关键词自动筛选出的最相关方法\n\n`;

      for (const utilMethod of methodsResult.selectedMethods) {
        content += `### ${utilMethod.className}\n`;
        content += `**包路径**: \`${utilMethod.packagePath}\`\n\n`;
        content += `**匹配的方法** (${utilMethod.methods.length} 个):\n\n`;

        utilMethod.methods.forEach((method, index) => {
          content += `${index + 1}. \`${method}\`\n`;
        });
        content += `\n`;
      }
    } else {
      // 回退到显示完整工具类信息
      if (analysisResult.selectedUtilClasses.length > 0) {
        content += `## 推荐使用的工具类\n\n`;
        if (!embeddingsProvider) {
          content += `> 未配置嵌入模型，显示完整工具类信息。要使用向量匹配功能，请在设置中配置嵌入模型。\n\n`;
        } else {
          content += `> 向量匹配未找到具体方法，显示完整工具类信息\n\n`;
        }

        for (const utilClass of analysisResult.selectedUtilClasses) {
          if (utilClass !== "分析过程中发生错误") {
            content += `### ${utilClass}\n`;
            const methods = await client.getUtilClassMethods(utilClass);
            content += `${methods}\n\n`;
          }
        }
      }
    }

    // 添加完整的开发规范
    if (analysisResult.frameworkRules.length > 0) {
      content += `## Ta+3 404框架开发规范\n\n`;
      content += analysisResult.frameworkRules.join("\n\n") + "\n\n";
    }

    // 添加针对不明白地方的提问
    if (analysisResult.frameworkQuestions.length > 0) {
      content += `## 需要进一步了解的问题\n\n`;
      content += `以下是针对开发规范中可能不清楚地方的具体提问，建议通过远程API或技术支持获取详细答案：\n\n`;

      for (let i = 0; i < analysisResult.frameworkQuestions.length; i++) {
        const question = analysisResult.frameworkQuestions[i];
        if (question !== "分析失败，请检查输入参数") {
          content += `${i + 1}. ${question}\n`;

          // 尝试通过远程API获取答案
          const answer = await client.getFrameworkRuleDetails(question);
          content += `   **答案**: ${answer}\n\n`;
        }
      }
    }

    return [
      {
        name: "Ta+3 404开发指南",
        description: "基于需求分析的工具类方法定义和开发规范详情",
        content: content,
      },
    ];
  } catch (error) {
    console.error("Agent development tool error:", error);
    return [
      {
        name: "Agent开发工具错误",
        description: "执行过程中发生错误",
        content: `错误信息: ${error instanceof Error ? error.message : String(error)}\n\n请检查网络连接和API配置，或联系技术支持。`,
      },
    ];
  }
};
