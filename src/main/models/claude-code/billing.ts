/**
 * Guards against requests silently moving from Claude plan limits to
 * pay-as-you-go usage credits (formerly "extra usage").
 */

import { envFlagEnabled } from "./env.ts";

export const ALLOW_USAGE_CREDITS_ENV = "PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS";

/** Claude Code's `rate_limit_event.rate_limit_info`, as far as this extension relies on it. */
export interface RateLimitInfo {
  status?: string;
  rateLimitType?: string;
  resetsAt?: number;
  isUsingOverage?: boolean;
  overageStatus?: string;
  overageDisabledReason?: string;
  [key: string]: unknown;
}

// Anthropic rejects or reroutes requests it classifies as third-party app
// usage with these messages. Every message we produce contains "billing" so
// Pi's retry classifier treats it as a non-retryable account error.
const USAGE_CREDITS_REJECTION =
  /third-party apps now draw from your extra usage|out of extra usage|draws? from your usage credits/iu;

export function usageCreditsAllowed(env: Record<string, string | undefined>): boolean {
  // Pi Runner 订阅入口没有额外付费放行路径。
  return false;
}

export function usageCreditsChargeError(info: RateLimitInfo): Error {
  return new Error(
    'Claude Code billing：本次请求使用了额外付费额度，而非订阅额度。已停止后续调用。请在 claude.ai/settings/usage 关闭额外付费后再使用；本次费用可能已产生。',
  );
}

/** Rewrite an Anthropic usage-credit rejection into an actionable, non-retryable error. */
export function describeUsageCreditsRejection(message: string): string | undefined {
  if (!USAGE_CREDITS_REJECTION.test(message)) return undefined;
  return (
    'Claude Code billing：服务不接受本次订阅请求，可能已用尽订阅额度，或被归类为第三方付费调用。不会自动重试或切换计费，请检查账户使用规则与额度。'
  );
}
