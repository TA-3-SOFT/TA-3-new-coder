import { ToolImpl } from ".";

interface RagQueryResult {
  content: string;
  source: string;
  score?: number;
  metadata?: Record<string, any>;
}

interface RagApiResponse {
  answer: string;
  results: RagQueryResult[];
  query?: string;
  total_results?: number;
}

export const ragKnowledgeQueryImpl: ToolImpl = async (args, extras) => {
  const { query } = args;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("查询内容不能为空");
  }

  // 获取组织信息
  let orgId: any = null;
  try {
    // 尝试从extras中获取组织信息
    if (extras.config && (extras.config as any).selectedOrgId) {
      orgId = (extras.config as any).selectedOrgId;
    }
  } catch (orgError) {
    console.warn("⚠️ [RAG查询] 无法获取组织信息:", orgError);
  }

  // 默认的RAG API URL，可以通过配置覆盖
  const defaultApiUrl =
    "http://192.168.20.195:8081/lowcodeback/api/knowledge/external/search/semantic/";
  const apiUrl = (extras.config as any)?.ragApiUrl || defaultApiUrl;

  try {
    console.log(`🔍 [RAG查询] 开始查询: "${query}"`);
    console.log(`🔗 [RAG查询] API地址: ${apiUrl}`);
    // 构建查询参数
    const params = new URLSearchParams({
      query: query.trim(),
      appId: orgId,
      // appId: "1cb76ad6656c415d87616b5a421668f1",
      topK: "10",
      minSimilarity: "0.4",
    });

    // 调用RAG API
    const response = await extras.fetch(`${apiUrl}?${params}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30秒超时
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ [RAG查询] API请求失败: ${response.status} - ${errorText}`,
      );
      throw new Error(
        `RAG API请求失败: ${response.status} ${response.statusText}`,
      );
    }

    // 处理流式响应
    let responseData: RagApiResponse;
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      // 标准JSON响应
      responseData = await response.json();
    } else {
      // 流式响应处理
      const responseText = await response.text();
      try {
        // 尝试解析为JSON
        responseData = JSON.parse(responseText);
      } catch {
        // 如果不是JSON，尝试从流式响应中提取数据
        responseData = parseStreamResponse(responseText);
      }
    }

    console.log(
      `✅ [RAG查询] 查询完成，获得 ${responseData.results?.length || 0} 个结果`,
    );

    // 格式化返回结果
    return formatRagResults(query, responseData);
  } catch (error) {
    console.error("❌ [RAG查询] 查询失败:", error);

    // 返回错误信息而不是抛出异常，让用户知道发生了什么
    return [
      {
        name: "RAG知识库查询失败",
        description: `查询内容: ${query}`,
        content: `# RAG知识库查询失败

**查询内容:** ${query}
**错误信息:** ${error instanceof Error ? error.message : String(error)}
`,
      },
    ];
  }
};

/**
 * 解析流式响应文本
 */
function parseStreamResponse(responseText: string): RagApiResponse {
  const lines = responseText.split("\n").filter((line) => line.trim());
  let answer = "";
  const results: RagQueryResult[] = [];

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.answer) {
        answer += data.answer;
      }
      if (data.results && Array.isArray(data.results)) {
        results.push(...data.results);
      }
    } catch {
      // 忽略无法解析的行
      continue;
    }
  }

  return { answer, results };
}

/**
 * 格式化RAG查询结果
 */
function formatRagResults(query: string, data: RagApiResponse) {
  const { answer, results = [] } = data;

  let content = `# RAG知识库查询结果\n\n`;
  content += `**查询内容:** ${query}\n`;

  if (answer && answer.trim()) {
    content += `## 智能回答\n\n${answer.trim()}\n\n`;
  }

  if (results.length > 0) {
    content += `## 相关知识片段\n\n`;

    results.forEach((result, index) => {
      content += `### ${index + 1}. ${result.source || "未知来源"}\n\n`;

      if (result.score !== undefined) {
        content += `**相关度:** ${(result.score * 100).toFixed(1)}%\n\n`;
      }

      content += `${result.content}\n\n`;

      if (result.metadata) {
        content += `**元数据:** ${JSON.stringify(result.metadata, null, 2)}\n\n`;
      }

      content += `---\n\n`;
    });
  } else {
    content += `## 查询结果\n\n未找到与 "${query}" 相关的知识内容。\n\n`;
  }

  return [
    {
      name: "RAG知识库查询结果",
      description: `查询: ${query} (${results.length} 个结果)}`,
      content,
    },
  ];
}
