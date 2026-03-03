import type { ModelProviderAdapter, ModelRequest, ModelResponse } from "../types.js";
import { TalosError } from "../errors.js";

export class ModelRegistry {
  private readonly providers = new Map<string, ModelProviderAdapter>();

  register(provider: ModelProviderAdapter): void {
    const id = provider.id.trim();
    if (!id) {
      throw new TalosError({
        code: "PROVIDER_INVALID",
        message: "Model provider id is required.",
      });
    }
    this.providers.set(id, provider);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const provider = this.providers.get(request.providerId);
    if (!provider) {
      throw new TalosError({
        code: "PROVIDER_NOT_FOUND",
        message: `Unknown provider: ${request.providerId}`,
      });
    }
    return await provider.generate(request);
  }
}
