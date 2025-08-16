import { config } from "dotenv";
import { z } from "zod";

// Load .env file in development.
// In a monorepo, this will be called from the root, where .env should be.
if (process.env.NODE_ENV === "development") {
  config();
}


const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // A database URL is a URI. The native URL constructor is too strict and
  // does not support all schemes (e.g., `postgresql://`).
  // This custom validation is a good middle-ground, checking for a scheme
  // without being too restrictive. The database driver will perform the
  // ultimate validation.
  DATABASE_URL: z
    .string()
    .min(1) // Catches empty strings
    .refine(
      (val) => val.includes('://'),
      { message: 'Must be a valid connection string / URI, including a scheme (e.g., "postgresql://...").' }
    )
    .optional(),
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