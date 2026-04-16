import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface WikiSidebarProps {
  onSelectPage: (relPath: string, absPath: string) => void;
  selectedRelPath: string | null;
}

const FOLDER_LABELS: Record<string, string> = {
  categories: 'Categories',
  domains: 'Domains',
  entities: 'Entities',
  entries: 'Entries',
};

export default function WikiSidebar({ onSelectPage, selectedRelPath }: WikiSidebarProps) {
  const { theme } = useTheme();
  const [tree, setTree] = useState<WikiFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('wiki-expanded-folders');
      return saved ? new Set(JSON.parse(saved)) : new Set(['entries']);
    } catch {
      return new Set(['entries']);
    }
  });

  const loadTree = useCallback(async () => {
    const result = await window.wikiAPI?.getTree();
    if (result) setTree(result);
  }, []);

  useEffect(() => {
    loadTree();
    const unsub = window.wikiAPI?.onPageChanged(() => loadTree());
    return () => unsub?.();
  }, [loadTree]);

  useEffect(() => {
    localStorage.setItem('wiki-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalPages = tree.reduce((sum, f) => sum + f.files.length, 0);

  if (tree.length === 0) {
    return (
      <div style={{ padding: '16px 12px', color: theme.textSecondary, fontSize: '11px' }}>
        No wiki pages yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync && ft wiki</code> to generate.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '4px 12px 8px', fontSize: '10px', color: theme.textSecondary }}>
        {totalPages} pages
      </div>
      {tree.map((folder) => {
        const isExpanded = expandedFolders.has(folder.name);
        return (
          <div key={folder.name}>
            {/* Folder header */}
            <div
              onClick={() => toggleFolder(folder.name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 12px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                color: theme.textSecondary,
                userSelect: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {/* Chevron */}
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="currentColor"
                style={{
                  transition: 'transform 0.15s ease',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  flexShrink: 0,
                }}
              >
                <path d="M2 1l4 3-4 3V1z" />
              </svg>
              <span>{FOLDER_LABELS[folder.name] ?? folder.name}</span>
              <span style={{ color: theme.textSecondary, fontWeight: 400, opacity: 0.6 }}>
                {folder.files.length}
              </span>
            </div>

            {/* File list */}
            {isExpanded && (
              <div>
                {folder.files.map((page) => {
                  const isSelected = page.relPath === selectedRelPath;
                  return (
                    <div
                      key={page.relPath}
                      onClick={() => onSelectPage(page.relPath, page.absPath)}
                      style={{
                        padding: '4px 12px 4px 28px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        color: isSelected ? theme.text : theme.textSecondary,
                        backgroundColor: isSelected ? theme.hoverBg : 'transparent',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = theme.hoverBg;
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                      title={page.title}
                    >
                      {page.title}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
