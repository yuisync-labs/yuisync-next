import type { LunaProviderUsage } from '../contracts'

// Sanitized transport error shared by inference providers. No raw prompts,
// credentials, provider request bodies or reasoning may enter a checkpoint.
export class LunaProviderError extends Error {
  constructor(readonly code: string, readonly retryAfter: string | null = null,
    readonly usage: LunaProviderUsage | null = null) {
    super(code)
    this.name = 'LunaProviderError'
  }
  get rateLimited() { return this.code.endsWith('_RATE_LIMITED') }
}
