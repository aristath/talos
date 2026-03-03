import { z } from "zod";

export const talosConfigSchema = z.object({
  providers: z.object({
    openaiCompatible: z.array(
      z.object({
        id: z.string().min(1),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1).optional(),
        headers: z.record(z.string()).optional(),
        defaultModel: z.string().min(1),
      }),
    ),
  }),
  tools: z
    .object({
      allow: z.array(z.string().min(1)).optional(),
      deny: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type TalosConfigSchema = z.infer<typeof talosConfigSchema>;
