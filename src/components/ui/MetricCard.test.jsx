import { fireEvent, render, screen } from '@testing-library/react'
import { Calendar } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { MetricCard } from './MetricCard'


describe('MetricCard', () => {
  it('renders the shared metric hierarchy', () => {
    render(
      <MetricCard
        icon={Calendar}
        label="Agendamentos hoje"
        value="12"
        description="8 confirmados"
      />
    )

    expect(screen.getByText('Agendamentos hoje')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8 confirmados')).toBeInTheDocument()
  })

  it('becomes an accessible action when onClick is provided', () => {
    const onClick = vi.fn()
    render(
      <MetricCard
        label="Estoque crítico"
        value="3"
        tone="danger"
        onClick={onClick}
      />
    )

    const action = screen.getByRole('button', { name: 'Estoque crítico: 3' })
    fireEvent.click(action)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
