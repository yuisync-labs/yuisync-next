import { describe, expect, it } from 'vitest'

import {
  META_WHATSAPP_GRAPH_VERSION,
} from '../src/adapters/metaWhatsAppGraphAdapter'
import {
  MetaWhatsAppOnboardingAdapter,
  MetaWhatsAppOnboardingError,
} from '../src/adapters/metaWhatsAppOnboardingAdapter'

function adapter(fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return new MetaWhatsAppOnboardingAdapter({
    appId: '123456789012345',
    appSecret: 'server-only-app-secret',
    redirectUri: 'https://yuisync.app/admin/meta-whatsapp',
    fetchFn,
  })
}

describe('MetaWhatsAppOnboardingAdapter', () => {
  it('troca code server-side, resolve business/phone pela Graph e não devolve payload Meta', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const subject = adapter(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/oauth/access_token?')) return Response.json({ access_token: 'business-token-secret' })
      if (url.includes('/phone_numbers')) return Response.json({ data: [{ id: '333333333333333', display_phone_number: '+55 32 99999-9999', verified_name: 'Quatro Patas' }] })
      if (url.includes('/222222222222222?')) return Response.json({ id: '222222222222222', name: 'WABA', owner_business_info: { id: '111111111111111', name: 'Business' } })
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await subject.complete({
      tenantId: 'tenant-quatro-patas',
      code: 'single-use-code',
      wabaId: '222222222222222',
      phoneNumberId: '333333333333333',
    })

    expect(result.connection).toEqual({
      type: 'whatsapp_account_connection',
      version: 1,
      tenant_id: 'tenant-quatro-patas',
      business_id: '111111111111111',
      waba_id: '222222222222222',
      phone_number_id: '333333333333333',
      display_phone_number: '+55 32 99999-9999',
      verified_name: 'Quatro Patas',
      status: 'pending',
    })
    expect(result.accessToken).toBe('business-token-secret')
    expect(calls[0].url).toContain(`/${META_WHATSAPP_GRAPH_VERSION}/oauth/access_token?`)
    expect(JSON.stringify(result.connection)).not.toContain('business-token-secret')
  })

  it('não aceita phone_number_id que não pertence ao WABA retornado pela Graph', async () => {
    const subject = adapter(async (input) => {
      const url = String(input)
      if (url.includes('/oauth/access_token?')) return Response.json({ access_token: 'secret' })
      if (url.includes('/phone_numbers')) return Response.json({ data: [{ id: '444444444444444' }] })
      return Response.json({ id: '222222222222222', owner_business_info: { id: '111111111111111' } })
    })

    await expect(subject.complete({
      tenantId: 'tenant-a',
      code: 'code',
      wabaId: '222222222222222',
      phoneNumberId: '333333333333333',
    })).rejects.toMatchObject({ code: 'WHATSAPP_ONBOARDING_ASSET_MISMATCH', retryable: false })
  })

  it('exige seleção quando a Graph retorna vários números e a sessão não identifica um', async () => {
    const subject = adapter(async (input) => {
      const url = String(input)
      if (url.includes('/oauth/access_token?')) return Response.json({ access_token: 'secret' })
      if (url.includes('/phone_numbers')) return Response.json({ data: [{ id: '333333333333333' }, { id: '444444444444444' }] })
      return Response.json({ id: '222222222222222', owner_business_info: { id: '111111111111111' } })
    })

    await expect(subject.complete({ tenantId: 'tenant-a', code: 'code', wabaId: '222222222222222' }))
      .rejects.toMatchObject({ code: 'WHATSAPP_ONBOARDING_PHONE_SELECTION_REQUIRED' })
  })

  it('assina o WABA sem incluir o token no erro sanitizado', async () => {
    const token = 'never-leak-this-token'
    const subject = adapter(async (input, init) => {
      expect(String(input)).toContain('/222222222222222/subscribed_apps')
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
      return Response.json({ error: { code: 190, error_subcode: 460, fbtrace_id: 'trace-1', message: `bad ${token}` } }, { status: 401 })
    })

    let caught: unknown
    try { await subject.subscribe('222222222222222', token) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(MetaWhatsAppOnboardingError)
    expect(caught).toMatchObject({ code: 'WHATSAPP_ONBOARDING_REJECTED', providerCode: '190', providerSubcode: '460', providerTraceId: 'trace-1' })
    expect(JSON.stringify(caught)).not.toContain(token)
    expect((caught as Error).message).not.toContain(token)
  })
})
