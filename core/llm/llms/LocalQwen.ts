import { Chunk, LLMOptions } from "../../index.js";

import OpenAI from "./OpenAI.js";

class LocalQwen extends OpenAI {
  static providerName = "localqwen";
  static defaultOptions: Partial<LLMOptions> | undefined = {
    apiBase: "http://172.80.2.7:18081/v1/",
    maxEmbeddingBatchSize: 10,
  };

  async rerank(query: string, chunks: Chunk[]): Promise<number[]> {
    if (!query || chunks.length === 0) {
      return [];
    }
    const url = new URL("rerank", "http://172.80.2.7:18082/v1/");
    const resp = await this.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        documents: chunks.map((chunk) => chunk.content),
        model: "qwen3-reranker-8b",
      }),
    });

    if (resp.status !== 200) {
      throw new Error(
        `LocalQwenReranker API error ${resp.status}: ${await resp.text()}`,
      );
    }

    const data = (await resp.json()) as {
      data: Array<{ index: number; relevance_score: number }>;
    };
    const results = data.data.sort((a, b) => a.index - b.index);
    return results.map((result) => result.relevance_score);
  }
}

export default LocalQwen;
