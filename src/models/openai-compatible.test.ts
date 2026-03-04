import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";

describe("createOpenAICompatibleProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses auth profile credentials when request specifies authProfileId", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "ok",
                },
              },
            ],
          };
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatibleProvider({
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "base-key",
      headers: {
        "x-base": "1",
      },
      resolveAuthProfile(profileId) {
        if (profileId === "main") {
          return {
            id: "main",
            apiKey: "profile-key",
            headers: {
              "x-profile": "y",
            },
          };
        }
        return undefined;
      },
    });

    await provider.generate({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      prompt: "hello",
      authProfileId: "main",
    });

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    expect(calls.length).toBe(1);
    const requestInit = (calls[0]?.[1] ?? {}) as { headers?: Record<string, string> };
    expect(requestInit.headers?.authorization).toBe("Bearer profile-key");
    expect(requestInit.headers?.["x-base"]).toBe("1");
    expect(requestInit.headers?.["x-profile"]).toBe("y");
  });

  it("throws when requested auth profile does not exist", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      resolveAuthProfile() {
        return undefined;
      },
    });

    await expect(
      provider.generate({
        providerId: "openai",
        modelId: "gpt-4o-mini",
        prompt: "hello",
        authProfileId: "missing",
      }),
    ).rejects.toThrow(/auth profile/i);
  });
});
