import { config } from "dotenv";
import { z } from "zod";

// Load .env file in development.
// In a monorepo, this will be called from the root, where .env should be.
if (process.env.NODE_ENV === "development") {
  config();
}


const connectionString = (name: string) =>
  z
    .string()
    .min(1, { message: `${name} cannot be empty.` })
    .refine((val) => val.includes("://"), {
      message: `${name} must be a valid connection string / URI, including a scheme (e.g., "protocol://...").`,
    });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Database & Cache ---
  DATABASE_URL: connectionString("DATABASE_URL").optional(),
  REDIS_URL: connectionString("REDIS_URL").optional(),

  // --- Auth ---
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required.").optional(),
  AUTH_URL: z.string().url("AUTH_URL must be a valid URL.").optional(),

  // --- SMTP ---
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email("SMTP_FROM must be a valid email address.").optional(),

  // --- Worker ---
  PLAYWRIGHT_USER_DATA_DIR: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

/**
 * Parses and returns the environment variables.
 * Throws a detailed error if the environment variables are invalid.
 */
export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors
    );
    // Embed the Zod error message into the thrown error for better test reports.
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }
  return parsed.data;
}