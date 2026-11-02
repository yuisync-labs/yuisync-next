import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CampanhasPage from './CampanhasPage'
import { campaignStorageKey } from '../lib/campaignDrafts'

const context = vi.hoisted(() => ({ tenantId: 'store-a', userId: 'user-a' }))
vi.mock('../../../context/AuthContext', () => ({
  useAuthCtx: () => ({
    activeTenantId: context.tenantId,
    session: { user: { id: context.userId } },
    storeSettings: { store_name: 'Pet Feliz' },
  }),
}))
vi.mock('../../../context/ModuleContext', () => ({
  useModuleCtx: () => ({ activeModuleId: 'petshop' }),
}))

beforeEach(() => {
  localStorage.clear()
  context.tenantId = 'store-a'
  context.userId = 'user-a'
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function createCampaign() {
  fireEvent.click(screen.getByRole('button', { name: 'Nova campanha' }))
  fireEvent.change(screen.getByLabelText('Nome da campanha'), {
    target: { value: 'Volta para o banho' },
  })
}

describe('campaign preparation workspace', () => {
  it('preserves a draft when reopening and isolates pending edits on tenant and user switches', () => {
    const { rerender } = render(<CampanhasPage />)
    createCampaign()
    fireEvent.click(
      screen.getByRole('radio', { name: /Recorrentes sem retorno/ }),
    )
    fireEvent.change(screen.getByLabelText('Sem retornar há mais de (dias)'), {
      target: { value: '60' },
    })
    context.tenantId = 'store-b'
    rerender(<CampanhasPage />)
    expect(
      screen.queryByDisplayValue('Volta para o banho'),
    ).not.toBeInTheDocument()
    expect(
      localStorage.getItem(campaignStorageKey('user-a', 'store-b', 'petshop')),
    ).toBeNull()
    context.tenantId = 'store-a'
    context.userId = 'user-b'
    rerender(<CampanhasPage />)
    expect(screen.queryByText('Volta para o banho')).not.toBeInTheDocument()
    context.userId = 'user-a'
    rerender(<CampanhasPage />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar Volta para o banho' }),
    )
    expect(screen.getByLabelText('Sem retornar há mais de (dias)')).toHaveValue(
      60,
    )
    expect(
      screen.getByRole('radio', { name: /Recorrentes sem retorno/ }),
    ).toBeChecked()
  })

  it('requires a new confirmation after editing and never enables approval or sending', () => {
    render(<CampanhasPage />)
    createCampaign()
    fireEvent.click(
      screen.getByRole('button', { name: /2. Mensagem e template/ }),
    )
    const message = screen.getByLabelText(/Texto da mensagem/)
    fireEvent.change(message, { target: { value: 'Olá, {{nome_tutor}}!' } })
    expect(screen.getByText('Olá, Marina!')).toBeInTheDocument()
    const review = screen.getByRole('checkbox', { name: /Revisei o texto/ })
    fireEvent.click(review)
    expect(review).toBeChecked()
    act(() => vi.advanceTimersByTime(600))
    fireEvent.change(message, {
      target: { value: 'Nova oferta para {{nome_pet}}' },
    })
    expect(review).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Enviar template para aprovação' }),
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: /3. Orçamento e envio/ }),
    )
    expect(
      screen.getByRole('button', { name: 'Enviar campanha' }),
    ).toBeDisabled()
    expect(screen.getByText('Indisponível')).toBeInTheDocument()
  })

  it('reports storage failure without claiming the draft is saved', () => {
    render(<CampanhasPage />)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    createCampaign()
    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível salvar',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Alterações não salvas',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Todas as campanhas' }))
    expect(screen.getByLabelText('Nome da campanha')).toHaveValue(
      'Volta para o banho',
    )
  })

  it('keeps corrupted storage untouched instead of overwriting existing drafts', () => {
    const key = campaignStorageKey('user-a', 'store-a', 'petshop')
    localStorage.setItem(key, '{invalid')
    render(<CampanhasPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'conteúdo salvo não foi substituído',
    )
    expect(screen.getByRole('button', { name: 'Nova campanha' })).toBeDisabled()
    expect(localStorage.getItem(key)).toBe('{invalid')
  })
})
