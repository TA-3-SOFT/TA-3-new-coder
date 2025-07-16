import { CompletionOptions, LLMOptions } from "../../index.js";

import OpenAI from "./OpenAI.js";

class Yinhai extends OpenAI {
  static providerName = "yinhai";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "http://192.168.20.91:5090/",
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
}

export default Yinhai;
