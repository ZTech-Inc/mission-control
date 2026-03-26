'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { GraphCanvas, type GraphCanvasRef, type Theme, type GraphNode as ReagraphNode, type GraphEdge as ReagraphEdge } from 'reagraph'
import type { DocFile } from '@/store'

interface OrgDocsPanelProps {
  entityType: 'department' | 'team'
  entityId: number
}

function getFileColor(filePath: string): string {
  if (filePath.endsWith('.md')) return '#f9e2af'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return '#cba6f7'
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return '#89b4fa'
  return '#94e2d5'
}

const obsidianTheme: Theme = {
  canvas: { background: '#11111b', fog: '#11111b' },
  node: {
    fill: '#6c7086', activeFill: '#cba6f7', opacity: 1, selectedOpacity: 1, inactiveOpacity: 0.1,
    label: { color: '#cdd6f4', stroke: '#11111b', activeColor: '#f5f5f7' }
  },
  ring: { fill: '#6c7086', activeFill: '#cba6f7' },
  edge: {
    fill: '#45475a', activeFill: '#cba6f7', opacity: 0.15, selectedOpacity: 0.5, inactiveOpacity: 0.03,
    label: { color: '#6c7086', activeColor: '#cdd6f4' }
  },
  arrow: { fill: '#45475a', activeFill: '#cba6f7' },
  lasso: { background: 'rgba(203, 166, 247, 0.08)', border: 'rgba(203, 166, 247, 0.25)' }
}

function parseWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]]+)\]\]/g) ?? []
  return matches.map(m => m.slice(2, -2))
}

function renderMarkdown(content: string, onWikiLinkClick: (target: string) => void): React.ReactNode {
  const lines = content.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mb-2">{line.slice(2)}</h1>
    if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-semibold mb-1">{line.slice(3)}</h2>
    if (line.startsWith('### ')) return <h3 key={i} className="text-base font-medium mb-1">{line.slice(4)}</h3>
    if (line === '') return <br key={i} />
    const parts = line.split(/(\[\[[^\]]+\]\])/)
    return (
      <p key={i} className="text-sm mb-1">
        {parts.map((part, j) => {
          if (part.startsWith('[[') && part.endsWith(']]')) {
            const target = part.slice(2, -2)
            return (
              <button key={j} onClick={() => onWikiLinkClick(target)} className="text-blue-400 hover:underline">
                {target}
              </button>
            )
          }
          return part
        })}
      </p>
    )
  })
}

interface TreeNodeProps {
  file: DocFile
  depth: number
  expandedDirs: Set<string>
  selectedPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}

function TreeNode({ file, depth, expandedDirs, selectedPath, onToggleDir, onSelectFile }: TreeNodeProps) {
  const isExpanded = expandedDirs.has(file.path)
  const isSelected = selectedPath === file.path

  if (file.type === 'directory') {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-1 text-xs hover:bg-surface-1 rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggleDir(file.path)}
        >
          <span>{isExpanded ? '▼' : '▶'}</span>
          <span className="text-muted-foreground">{file.name}</span>
        </button>
        {isExpanded && file.children?.map(child => (
          <TreeNode
            key={child.path}
            file={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            onToggleDir={onToggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      className={`flex items-center gap-1 w-full text-left px-2 py-1 text-xs rounded transition-colors ${isSelected ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:bg-surface-1 hover:text-foreground'}`}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
      onClick={() => onSelectFile(file.path)}
    >
      <span>📄</span>
      <span className="truncate">{file.name}</span>
    </button>
  )
}

export function OrgDocsPanel({ entityType, entityId }: OrgDocsPanelProps) {
  const [view, setView] = useState<'files' | 'graph'>('files')
  const [docs, setDocs] = useState<DocFile[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [wikiLinks, setWikiLinks] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const graphRef = useRef<GraphCanvasRef | null>(null)

  async function loadContent(docPath: string) {
    setSelectedPath(docPath)
    const url = entityType === 'department'
      ? `/api/departments/${entityId}/docs/content?path=${encodeURIComponent(docPath)}`
      : `/api/teams/${entityId}/docs/content?path=${encodeURIComponent(docPath)}`
    try {
      const res = await fetch(url)
      if (!res.ok) { setContent('# Not found\n'); setWikiLinks([]); return }
      const { content: c } = await res.json()
      setContent(c ?? '')
      setWikiLinks(parseWikiLinks(c ?? ''))
    } catch {
      setContent('# Not found\n')
      setWikiLinks([])
    }
  }

  useEffect(() => {
    async function loadDocs() {
      const url = entityType === 'department'
        ? `/api/departments/${entityId}/docs`
        : `/api/teams/${entityId}/docs`
      try {
        const res = await fetch(url)
        if (!res.ok) { setDocs([]); return }
        const { docs } = await res.json()
        setDocs(docs ?? [])
        setSelectedPath(null)
        setContent(null)
        setWikiLinks([])
        const firstFile = (docs ?? []).find((d: DocFile) => d.type === 'file')
        if (firstFile) loadContent(firstFile.path)
      } catch {
        setDocs([])
      }
    }
    loadDocs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId])

  function handleWikiLinkClick(target: string) {
    const found = docs.find(d => d.name === target + '.md' || d.name === target)
    if (found) {
      setView('files')
      loadContent(found.path)
    }
  }

  function handleToggleDir(path: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function handleNodeClick(node: ReagraphNode) {
    if (!node?.id) return
    const found = docs.find(d => d.path === node.id)
    if (found) {
      setView('files')
      loadContent(found.path)
    }
  }

  const { graphNodes, graphEdges } = useMemo(() => {
    const flatFiles = docs.filter(d => d.type === 'file')
    const nodes: ReagraphNode[] = flatFiles.map(d => ({
      id: d.path,
      label: d.name,
      fill: getFileColor(d.path),
      size: selectedPath === d.path ? 10 : 6,
    }))

    const edges: ReagraphEdge[] = []
    if (selectedPath && content) {
      const links = parseWikiLinks(content)
      links.forEach(link => {
        const target = docs.find(d => d.name === link + '.md' || d.name === link)
        if (target) {
          edges.push({
            id: `${selectedPath}->${target.path}`,
            source: selectedPath,
            target: target.path,
          })
        }
      })
    }

    return { graphNodes: nodes, graphEdges: edges }
  }, [docs, selectedPath, content])

  const filteredDocs = useMemo(() => {
    if (!searchQuery) return docs
    // Collect matching file paths
    const matchingFilePaths = new Set(
      docs.filter(d => d.type === 'file' && d.name.toLowerCase().includes(searchQuery.toLowerCase())).map(d => d.path)
    )
    // Include all docs whose path is matched or is a prefix of a matched path
    return docs.filter(d => {
      if (matchingFilePaths.has(d.path)) return true
      // Include directory if any matching file starts with this dir's path
      if (d.type === 'directory') {
        return Array.from(matchingFilePaths).some(fp => fp.startsWith(d.path + '/'))
      }
      return false
    })
  }, [docs, searchQuery])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => setView('files')}
            className={`px-3 py-1 text-xs rounded ${view === 'files' ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Files
          </button>
          <button
            onClick={() => setView('graph')}
            className={`px-3 py-1 text-xs rounded ${view === 'graph' ? 'bg-surface-1 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Graph
          </button>
        </div>
        {view === 'files' && (
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-surface-1 border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none w-40"
          />
        )}
        <div className="flex-1" />
        <button
          onClick={() => {
            setIsEditing(true)
            setContent('')
            setSelectedPath(null)
          }}
          className="text-xs px-2 py-1 rounded bg-surface-1 border border-border text-muted-foreground hover:text-foreground"
        >
          + New Doc
        </button>
      </div>

      {view === 'files' ? (
        <div className="flex flex-1 min-h-0">
          {/* File tree sidebar */}
          <div className="w-48 shrink-0 border-r border-border overflow-y-auto py-2">
            {filteredDocs.map(doc => (
              <TreeNode
                key={doc.path}
                file={doc}
                depth={0}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onToggleDir={handleToggleDir}
                onSelectFile={loadContent}
              />
            ))}
          </div>

          {/* Content pane */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedPath ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-muted-foreground">{selectedPath}</div>
                  <button
                    onClick={() => {
                      setIsEditing(!isEditing)
                      setEditContent(content ?? '')
                    }}
                    className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    {isEditing ? 'View' : 'Edit'}
                  </button>
                </div>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="w-full h-64 bg-surface-1 border border-border rounded p-3 text-sm font-mono text-foreground focus:outline-none resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setContent(editContent)
                          setWikiLinks(parseWikiLinks(editContent))
                          setIsEditing(false)
                        }}
                        className="text-xs px-3 py-1 rounded bg-primary/20 border border-primary/30 text-primary"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="text-xs px-3 py-1 rounded border border-border text-muted-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none text-foreground">
                    {content && renderMarkdown(content, handleWikiLinkClick)}
                  </div>
                )}
                {wikiLinks.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-xs text-muted-foreground mb-2">Links</div>
                    <div className="flex flex-wrap gap-2">
                      {wikiLinks.map(link => (
                        <button
                          key={link}
                          onClick={() => handleWikiLinkClick(link)}
                          className="text-xs px-2 py-0.5 rounded bg-surface-1 border border-border text-muted-foreground hover:text-foreground"
                        >
                          [[{link}]]
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a document</div>
            )}
          </div>
        </div>
      ) : (
        /* Graph view */
        <div className="flex-1">
          {graphNodes.length > 0 ? (
            <GraphCanvas
              ref={graphRef}
              nodes={graphNodes}
              edges={graphEdges}
              theme={obsidianTheme}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No documents
            </div>
          )}
        </div>
      )}
    </div>
  )
}
