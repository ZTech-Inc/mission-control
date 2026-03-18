'use client'

import React from 'react'

interface EntityListSidebarProps<T extends { id: number }> {
  items: T[]
  renderItem: (item: T, isSelected: boolean) => React.ReactNode
  selectedId: number | null
  onSelect: (item: T) => void
  createLabel: string
  onCreate: () => void
  filterComponent?: React.ReactNode
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function EntityListSidebar<T extends { id: number }>({
  items,
  renderItem,
  selectedId,
  onSelect,
  createLabel,
  onCreate,
  filterComponent,
  sidebarOpen,
  onToggleSidebar,
}: EntityListSidebarProps<T>) {
  return (
    <div
      className={`flex flex-col border-r border-border bg-card transition-all duration-200 ${
        sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'
      }`}
    >
      {sidebarOpen && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-medium text-foreground">
              {createLabel}
            </span>
            <button
              onClick={onToggleSidebar}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
              title="Collapse sidebar"
            >
              ◀
            </button>
          </div>

          {/* Optional filter area */}
          {filterComponent && (
            <div className="px-3 py-2 border-b border-border">{filterComponent}</div>
          )}

          {/* Scrollable item list */}
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelect(item)}
                className={`cursor-pointer transition-colors ${
                  selectedId === item.id
                    ? 'bg-surface-1'
                    : 'hover:bg-surface-1/50'
                }`}
              >
                {renderItem(item, selectedId === item.id)}
              </div>
            ))}
          </div>

          {/* Create button at bottom */}
          <div className="p-3 border-t border-border">
            <button
              onClick={onCreate}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border hover:border-foreground rounded transition-colors"
            >
              <span>+</span>
              <span>{createLabel}</span>
            </button>
          </div>
        </>
      )}

      {!sidebarOpen && (
        <button
          onClick={onToggleSidebar}
          className="p-2 text-muted-foreground hover:text-foreground text-xs"
          title="Expand sidebar"
        >
          ▶
        </button>
      )}
    </div>
  )
}
