// Common types shared across the monorepo
export interface UsageEvent {
  model: string;
  inputWithCacheWriteTokens: number;
  inputWithoutCacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiCostCents: number;
  costToYouCents: number;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
}
