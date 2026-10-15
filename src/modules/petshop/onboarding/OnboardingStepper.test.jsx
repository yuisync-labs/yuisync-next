import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OnboardingStepper } from './OnboardingStepper'

describe('OnboardingStepper', () => {
  it('allows navigation only among steps already unlocked', () => {
    const onStepChange = vi.fn()
    render(
      <OnboardingStepper
        currentStep={1}
        maxAccessibleStep={3}
        onStepChange={onStepChange}
        steps={['Empresa', 'Operação', 'Módulos', 'Concluir']}
      />,
    )

    expect(screen.getByRole('button', { name: '1. Empresa' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '2. Operação' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '3. Módulos' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /4\. Concluir/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '2. Operação' }))
    expect(onStepChange).toHaveBeenCalledWith(2)
  })
})

