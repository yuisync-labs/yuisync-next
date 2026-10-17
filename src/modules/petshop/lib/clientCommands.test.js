import { afterEach, expect, it, vi } from 'vitest'
import { listClientPetsCommand } from './clientCommands'

vi.mock('../../../lib/visualPreview', () => ({ isVisualPreviewSession: () => false }))
afterEach(() => vi.unstubAllGlobals())

it('carrega além dos primeiros mil pets e mantém a busca rápida limitada a uma página', async () => {
  const first = Array.from({ length: 1000 }, (_, i) => ({ id: `pet-${i}`, owner_name: 'Ana', pet_name: `Pet ${i}` }))
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ clients: first, next_cursor: 'pet-999' }))
    .mockResolvedValueOnce(Response.json({ clients: [{ id: 'joelane', owner_name: 'Joelane', pet_name: 'Maria Luiza' }], next_cursor: null }))
    .mockResolvedValueOnce(Response.json({ clients: first.slice(0, 20), next_cursor: 'ignored' }))
  vi.stubGlobal('fetch', fetch)
  const result = await listClientPetsCommand({ tenantId: 'tenant', allPages: true })
  expect(result).toHaveLength(1001)
  expect(result.at(-1).pet_name).toBe('Maria Luiza')
  expect(fetch.mock.calls[1][0]).toContain('after=pet-999')
  expect(fetch.mock.calls[0][0]).toContain('paginate=1')
  expect(await listClientPetsCommand({ tenantId: 'tenant', search: 'Ana', limit: 20 })).toHaveLength(20)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls[2][0]).not.toContain('paginate')
})

it('não apresenta um total parcial como completo quando uma página falha ou repete o cursor', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ clients: [{ id: 'a' }], next_cursor: 'a' }))
    .mockResolvedValueOnce(Response.json({ code: 'DATABASE_UNAVAILABLE' }, { status: 503 }))
    .mockImplementation(async () => Response.json({ clients: [{ id: 'a' }], next_cursor: 'a' }))
  vi.stubGlobal('fetch', fetch)
  await expect(listClientPetsCommand({ tenantId: 'tenant', allPages: true })).rejects.toThrow('DATABASE_UNAVAILABLE')
  await expect(listClientPetsCommand({ tenantId: 'tenant', allPages: true })).rejects.toThrow('carregar todos')
  expect(fetch).toHaveBeenCalledTimes(4)
})
