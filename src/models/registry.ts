import type { ModelProviderAdapter, ModelRequest, ModelResponse } from "../types.js";
import { SoulSwitchError } from "../errors.js";

export class ModelRegistry {
  private readonly providers = new Map<string, ModelProviderAdapter>();

  register(provider: ModelProviderAdapter): void {
    const id = provider.id.trim();
    if (!id) {
      throw new SoulSwitchError({
        code: "PROVIDER_INVALID",
        message: "Model provider id is required.",
      });
    }
    this.providers.set(id, provider);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId.trim());
  }

  remove(providerId: string): boolean {
    const normalizedId = providerId.trim();
    if (!normalizedId) {
      return false;
    }
    return this.providers.delete(normalizedId);
  }

  list(): ModelProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const provider = this.providers.get(request.providerId);
    if (!provider) {
      throw new SoulSwitchError({
        code: "PROVIDER_NOT_FOUND",
        message: `Unknown provider: ${request.providerId}`,
      });
    }
    return await provider.generate(request);
  }
}
