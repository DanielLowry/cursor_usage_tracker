import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Validate the DATABASE_URL from the .env file
  DATABASE_URL: z.string().url().min(1, "DATABASE_URL is required"),
});

// This will throw a runtime error if the environment variables are invalid.
export const env = EnvSchema.parse(process.env);