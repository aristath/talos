import { z } from "zod";

export const talosConfigSchema = z.object({
  authProfiles: z
    .record(
      z.object({
        apiKey: z.string().min(1).optional(),
        headers: z.record(z.string()).optional(),
      }),
    )
    .optional(),
  providers: z.object({
    openaiCompatible: z.array(
      z.object({
        id: z.string().min(1),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1).optional(),
        authProfileId: z.string().min(1).optional(),
        headers: z.record(z.string()).optional(),
        defaultModel: z.string().min(1),
      }),
    ),
  }),
  models: z
    .object({
      requestTimeoutMs: z.number().int().positive().optional(),
      retriesPerModel: z.number().int().min(0).max(10).optional(),
      retryDelayMs: z.number().int().min(0).max(60_000).optional(),
      toolLoopMaxSteps: z.number().int().min(0).max(20).optional(),
    })
    .optional(),
  persona: z
    .object({
      bootstrapMaxChars: z.number().int().positive().optional(),
      bootstrapTotalMaxChars: z.number().int().positive().optional(),
      extraFiles: z.array(z.string().min(1)).optional(),
      contextMode: z.enum(["full", "lightweight"]).optional(),
    })
    .optional(),
  tools: z
    .object({
      allow: z.array(z.string().min(1)).optional(),
      deny: z.array(z.string().min(1)).optional(),
      executionTimeoutMs: z.number().int().positive().optional(),
      web: z
        .object({
          search: z
            .object({
              cacheTtlMs: z.number().int().positive().optional(),
            })
            .optional(),
          fetch: z
            .object({
              defaultMaxChars: z.number().int().positive().optional(),
              maxCharsCap: z.number().int().positive().optional(),
              timeoutMs: z.number().int().positive().optional(),
              maxResponseBytes: z.number().int().positive().optional(),
              maxRedirects: z.number().int().nonnegative().optional(),
              userAgent: z.string().min(1).optional(),
              cacheTtlMs: z.number().int().positive().optional(),
              allowPrivateNetwork: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  runtime: z
    .object({
      stateFile: z.string().min(1).optional(),
    })
    .optional(),
  security: z
    .object({
      redactKeys: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type TalosConfigSchema = z.infer<typeof talosConfigSchema>;
