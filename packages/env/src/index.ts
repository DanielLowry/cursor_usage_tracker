import { z } from "zod";

// This is a placeholder for your environment variables.
// As you add variables, define them here with Zod schemas.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Example: DATABASE_URL: z.string().url(),
});

// You can export a parsed and validated env object from here.
export const env = EnvSchema.parse(process.env);