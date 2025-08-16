import { config } from "dotenv";
import { z } from "zod";

// Load .env file in development.
// In a monorepo, this will be called from the root, where .env should be.
if (process.env.NODE_ENV === "development") {
  config();
}


const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Check we have a non-empty string for url
  DATABASE_URL: z.string().min(1).optional(),
});

export type Config = z.infer<typeof EnvSchema>;

/**
 * Parses and returns the environment variables.
 * Throws an error if the environment variables are invalid.
 */
export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}