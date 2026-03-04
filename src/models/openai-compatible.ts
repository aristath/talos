import type { AuthProfile, ModelProviderAdapter, ModelRequest, ModelResponse } from "../types.js";

export type OpenAICompatibleProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  defaultAuthProfileId?: string;
  resolveAuthProfile?: (profileId: string) => AuthProfile | undefined;
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
      const requestedProfileId = request.authProfileId ?? config.defaultAuthProfileId;
      const requestedProfile = requestedProfileId ? config.resolveAuthProfile?.(requestedProfileId) : undefined;
      if (requestedProfileId && !requestedProfile) {
        throw new Error(`Provider ${config.id} could not resolve auth profile: ${requestedProfileId}`);
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(config.headers ?? {}),
        ...(requestedProfile?.headers ?? {}),
      };
      const apiKey = requestedProfile?.apiKey ?? config.apiKey;
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: request.modelId,
          ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
          ...(typeof request.maxTokens === "number" ? { max_tokens: request.maxTokens } : {}),
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
