import { describe, expect, it } from "vitest";
import { createSoulSwitch } from "../soulSwitch.js";

const runLive = process.env.SOULSWITCH_E2E_LIVE === "1" ? describe : describe.skip;
const modelLive =
  process.env.SOULSWITCH_E2E_BASE_URL?.trim() &&
  process.env.SOULSWITCH_E2E_API_KEY?.trim() &&
  process.env.SOULSWITCH_E2E_MODEL?.trim();
const LIVE_TIMEOUT_MS = 90_000;

runLive("tools live e2e", () => {
  it(
    "runs web_search with duckduckgo without API key",
    async () => {
      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [
            {
              id: "openai",
              baseUrl: "https://api.openai.com/v1",
              defaultModel: "gpt-4o-mini",
            },
          ],
        },
      });

      soulSwitch.registerWebTools({
        search: {
          defaultProvider: "duckduckgo",
        },
      });

      const result = await soulSwitch.executeTool({
        name: "web_search",
        args: {
          query: "OpenAI",
          count: 3,
          provider: "duckduckgo",
        },
        context: {
          agentId: "main",
        },
      });

      const data = result.data as {
        provider?: string;
        results?: Array<{ title?: string; url?: string }>;
        externalContent?: { source?: string; provider?: string };
      };

      expect(data.provider).toBe("duckduckgo");
      expect(Array.isArray(data.results)).toBe(true);
      expect((data.results?.length ?? 0) > 0).toBe(true);
      expect(typeof data.results?.[0]?.title).toBe("string");
      expect((data.results?.[0]?.url ?? "").startsWith("http")).toBe(true);
      expect(data.externalContent?.source).toBe("web_search");
      expect(data.externalContent?.provider).toBe("duckduckgo");
    },
    LIVE_TIMEOUT_MS,
  );

  const runModelLive = modelLive ? it : it.skip;

  runModelLive(
    "lets a real model call web_search through agent run",
    async () => {
      const providerId = process.env.SOULSWITCH_E2E_PROVIDER_ID?.trim() || "openrouter";
      const baseUrl = process.env.SOULSWITCH_E2E_BASE_URL!.trim();
      const apiKey = process.env.SOULSWITCH_E2E_API_KEY!.trim();
      const modelId = process.env.SOULSWITCH_E2E_TOOL_MODEL?.trim() || "openai/gpt-4.1-mini";

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [
            {
              id: providerId,
              baseUrl,
              apiKey,
              defaultModel: modelId,
            },
          ],
        },
        models: {
          toolLoopMaxSteps: 2,
          requestTimeoutMs: 60_000,
        },
      });

      soulSwitch.registerAgent({
        id: "main",
        model: {
          providerId,
          modelId,
        },
      });
      soulSwitch.registerWebTools({
        search: {
          defaultProvider: "duckduckgo",
        },
      });

      let toolInvoked = false;
      let runText = "";

      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const result = await soulSwitch.run({
            agentId: "main",
            prompt:
              'Output only the following text: {"tool":"web_search","args":{"provider":"duckduckgo","query":"OpenAI official website","count":1},"final":"tool_invoked"}',
          });
          runText = result.text;
          const toolEvents = soulSwitch
            .queryEvents({
              type: "tool.completed",
            })
            .filter((event) => (event.data as { runId?: string }).runId === result.runId);
          const webSearchEvent = toolEvents.find(
            (event) => (event.data as { name?: string }).name === "web_search",
          );
          if (webSearchEvent) {
            toolInvoked = true;
            break;
          }
        } catch {
          // Some upstream responses can be empty on individual attempts; retry.
        }
      }

      expect(toolInvoked).toBe(true);
      expect(runText).toBe("tool_invoked");
    },
    LIVE_TIMEOUT_MS,
  );
});
