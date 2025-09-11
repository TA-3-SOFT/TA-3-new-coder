import { CompletionOptions, LLMOptions } from "../../index.js";

import OpenAI from "./OpenAI.js";

class Yinhai extends OpenAI {
  static providerName = "yinhai";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "http://192.168.20.91:5090/",
    maxEmbeddingBatchSize: 100,
    maxEmbeddingChunkSize: 2048,
  };
  maxStopWords: number | undefined = 16;

  supportsFim(): boolean {
    return true;
  }

  async *_streamFim(
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const endpoint = new URL("/code/completion", this.apiBase);
    const resp = await this.fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        prompt: prefix,
        suffix,
        max_new_tokens: options.maxTokens,
        temperature: options.temperature,
        stop_strings: options.stop,
      }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal,
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.completion) {
        yield data.completion;
      }
    }
  }

  async _embed(chunks: string[]): Promise<number[][]> {
    const resp = await this.fetch(new URL("embeddings", this.apiBase), {
      method: "POST",
      body: JSON.stringify({
        input: chunks,
        model: this.model,
        dimensions: 768,
        ...this.extraBodyProperties(),
      }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "api-key": this.apiKey ?? "", // For Azure
      },
    });

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const data = (await resp.json()) as any;
    return data.data.map((result: { embedding: number[] }) => result.embedding);
  }
}

export default Yinhai;
