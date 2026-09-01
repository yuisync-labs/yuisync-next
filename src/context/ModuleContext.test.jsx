import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ModuleProvider, useModuleCtx } from './ModuleContext'

const modules = {
  petshop: { id: 'petshop', name: 'PetShop CRM' },
}

function Probe() {
  const navigate = useNavigate()
  const { activeModuleId, activeModule } = useModuleCtx()
  return (
    <>
      <output data-testid="module">{activeModuleId || 'hub'}</output>
      <output data-testid="name">{activeModule?.name || 'Hub'}</output>
      <button type="button" onClick={() => navigate('/petshop')}>Abrir PetShop</button>
      <button type="button" onClick={() => navigate('/')}>Abrir Hub</button>
    </>
  )
}

describe('ModuleProvider routing', () => {
  it('derives the active module from the URL without a competing state transition', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ModuleProvider modules={modules}><Probe /></ModuleProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('module')).toHaveTextContent('hub')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir PetShop' }))
    expect(screen.getByTestId('module')).toHaveTextContent('petshop')
    expect(screen.getByTestId('name')).toHaveTextContent('PetShop CRM')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Hub' }))
    expect(screen.getByTestId('module')).toHaveTextContent('hub')
  })
})
