'use client'

import { useDroppable, useDraggable } from '@dnd-kit/core'
import type { Agent } from '@/store'

export function StatusDot({ status }: { status: Agent['status'] }) {
  const color =
    status === 'idle'
      ? 'bg-green-500'
      : status === 'busy'
      ? 'bg-yellow-500'
      : status === 'error'
      ? 'bg-red-500'
      : 'bg-gray-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

export function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg p-3 min-h-[60px] transition-colors ${
        isOver ? 'border-primary border-dashed bg-primary/5' : 'border-border'
      }`}
    >
      {children}
    </div>
  )
}

export function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` }
          : undefined
      }
      className={isDragging ? 'opacity-50' : ''}
    >
      {children}
    </div>
  )
}
