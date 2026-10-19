import { GroqSdkProvider } from './groqSdkProvider'
import { WorkersAiProvider, GLM_FLASH_MODEL } from './workersAiProvider'
import { LunaProviderError } from './providerError'

export type LunaProviderBindings = {APP_ENV?: string; LUNA_ENABLED?: string; LUNA_PROVIDER?: string; LUNA_MODEL?: string; GROQ_API_KEY?: string; AI?: EdgeEnv['AI']}
export function lunaProviderIdentity(env: LunaProviderBindings) {
  const provider = env.LUNA_PROVIDER ?? 'groq'
  if (provider === 'groq' && env.LUNA_MODEL) return {provider, model: env.LUNA_MODEL}
  if (provider === 'workers-ai' && env.APP_ENV === 'staging' && env.LUNA_ENABLED === 'false' && env.LUNA_MODEL === GLM_FLASH_MODEL && env.AI) return {provider, model: GLM_FLASH_MODEL}
  throw new LunaProviderError('LUNA_PROVIDER_NOT_CONFIGURED')
}
export function lunaProviderConfigured(env: LunaProviderBindings) {
  try {return lunaProviderIdentity(env).provider !== 'groq' || !!env.GROQ_API_KEY} catch {return false}
}
export function createLunaProvider(env: LunaProviderBindings) {
  return lunaProviderIdentity(env).provider === 'workers-ai' ? new WorkersAiProvider(env.AI!) : new GroqSdkProvider({apiKey: env.GROQ_API_KEY, model: env.LUNA_MODEL})
}
export function lunaJournalConfiguration(env: LunaProviderBindings, legacy: string) {
  const identity = lunaProviderIdentity(env)
  // Preserve old Groq fingerprints; never reuse them for a different provider.
  return identity.provider === 'groq' ? legacy : `${legacy}:workers-ai:thinking-off:v1`
}
