'use client'

interface OrgDocsPanelProps {
  entityType: 'department' | 'team'
  entityId: number
}

export function OrgDocsPanel({ entityType, entityId }: OrgDocsPanelProps) {
  return (
    <div className="p-4 text-muted-foreground text-sm">
      Docs for {entityType} #{entityId} — Phase 5
    </div>
  )
}
