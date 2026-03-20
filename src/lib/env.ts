import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  TRIGGER_SECRET_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
