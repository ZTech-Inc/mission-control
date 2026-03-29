import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentStatusBadge } from '../agent-status-badge'

describe('AgentStatusBadge', () => {
  it('renders idle dot with green color and small size', () => {
    render(<AgentStatusBadge status="idle" variant="dot" />)

    const dot = screen.getByLabelText('Agent status: idle')
    expect(dot).toHaveClass('bg-green-500')
    expect(dot).toHaveClass('w-2')
    expect(dot).toHaveClass('h-2')
  })

  it('renders busy dot with yellow color and pulse-dot class', () => {
    render(<AgentStatusBadge status="busy" variant="dot" />)

    const dot = screen.getByLabelText('Agent status: busy')
    expect(dot).toHaveClass('bg-yellow-500')
    expect(dot).toHaveClass('pulse-dot')
  })

  it('renders labeled error status', () => {
    render(<AgentStatusBadge status="error" variant="labeled" />)

    expect(screen.getByText('Error')).toBeInTheDocument()
    const dot = screen.getByLabelText('Agent status: error')
    expect(dot).toHaveClass('bg-red-500')
  })

  it('renders labeled offline status', () => {
    render(<AgentStatusBadge status="offline" variant="labeled" />)

    expect(screen.getByText('Offline')).toBeInTheDocument()
    const dot = screen.getByLabelText('Agent status: offline')
    expect(dot).toHaveClass('bg-gray-500')
  })

  it('shows queue hint only for busy labeled-with-queue variant', () => {
    const { rerender } = render(<AgentStatusBadge status="busy" variant="labeled-with-queue" />)

    expect(screen.getByText('Busy')).toBeInTheDocument()
    expect(screen.getByText('Busy -- messages will queue')).toBeInTheDocument()

    rerender(<AgentStatusBadge status="idle" variant="labeled-with-queue" />)
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.queryByText('Busy -- messages will queue')).not.toBeInTheDocument()
  })
})
