import type { ModelProviderAdapter, ModelRequest, ModelResponse } from "../types.js";

export type OpenAICompatibleProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleProviderConfig,
): ModelProviderAdapter {
  return {
    id: config.id,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const url = new URL("/chat/completions", config.baseUrl).toString();
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...config.headers,
      };
      if (config.apiKey) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: request.modelId,
          messages: [
            ...(request.system ? [{ role: "system", content: request.system }] : []),
            { role: "user", content: request.prompt },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Provider ${config.id} failed with status ${response.status}`);
      }
      const payload = (await response.json()) as OpenAIChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error(`Provider ${config.id} returned an empty response.`);
      }
      return {
        text,
        providerId: request.providerId,
        modelId: request.modelId,
      };
    },
  };
}
