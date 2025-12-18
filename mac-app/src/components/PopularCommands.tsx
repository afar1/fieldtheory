// =============================================================================
// PopularCommands - Community-shared cursor commands with copy tracking.
// Users can browse, copy, search, and share commands.
// Copy count (times copied) determines popularity ranking.
// =============================================================================

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';

type Command = {
  id: string;
  name: string;
  content: string;
  copy_count: number;
  contributed_by: string | null;
  created_at: string;
};

/**
 * PopularCommands - Browse, search, copy, and share cursor commands.
 * Popularity is tracked by copy count (each copy increments the counter).
 */
export default function PopularCommands() {
  const { theme } = useTheme();
  
  // Commands state.
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search state.
  const [searchQuery, setSearchQuery] = useState('');
  
  // Share/contribute state.
  const [showShareForm, setShowShareForm] = useState(false);
  const [newCommandName, setNewCommandName] = useState('');
  const [newCommandContent, setNewCommandContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  
  // Feedback state for copy action.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch commands on mount.
  useEffect(() => {
    fetchCommands();
  }, []);

  // Fetch all commands ordered by popularity.
  const fetchCommands = async () => {
    if (!supabase) {
      // Use mock data if Supabase is not configured.
      setCommands(getMockCommands());
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('popular_commands')
        .select('*')
        .order('copy_count', { ascending: false })
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setCommands(data || []);
    } catch (err) {
      console.error('Failed to fetch commands:', err);
      setError('Failed to load commands');
      // Fall back to mock data on error.
      setCommands(getMockCommands());
    } finally {
      setLoading(false);
    }
  };

  // Filter commands based on search query.
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;
    
    const query = searchQuery.toLowerCase();
    return commands.filter(cmd => 
      cmd.name.toLowerCase().includes(query) ||
      cmd.content.toLowerCase().includes(query)
    );
  }, [commands, searchQuery]);

  // Split into top 10 and the rest.
  const topCommands = useMemo(() => filteredCommands.slice(0, 10), [filteredCommands]);
  const otherCommands = useMemo(() => filteredCommands.slice(10), [filteredCommands]);

  // Copy command to clipboard and increment counter.
  const handleCopy = useCallback(async (command: Command) => {
    // Copy to clipboard.
    try {
      await navigator.clipboard.writeText(command.content);
      setCopiedId(command.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
      return;
    }

    // Increment copy count in database.
    if (supabase) {
      try {
        const { data, error: rpcError } = await supabase
          .rpc('increment_command_copy_count', { command_id: command.id });
        
        if (rpcError) throw rpcError;
        
        // Update local state with new count.
        if (typeof data === 'number') {
          setCommands(prev => prev.map(cmd => 
            cmd.id === command.id ? { ...cmd, copy_count: data } : cmd
          ));
        }
      } catch (err) {
        // Silent fail - copy still worked, just count not updated.
        console.error('Failed to increment copy count:', err);
      }
    } else {
      // Mock: increment locally.
      setCommands(prev => prev.map(cmd =>
        cmd.id === command.id ? { ...cmd, copy_count: cmd.copy_count + 1 } : cmd
      ));
    }
  }, []);

  // Submit a new shared command.
  const handleSubmitCommand = useCallback(async () => {
    if (!newCommandName.trim() || !newCommandContent.trim()) {
      setSubmitError('Name and content are required');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    if (!supabase) {
      // Mock: add locally.
      const mockCommand: Command = {
        id: `local-${Date.now()}`,
        name: newCommandName.trim(),
        content: newCommandContent.trim(),
        copy_count: 0,
        contributed_by: null,
        created_at: new Date().toISOString(),
      };
      setCommands(prev => [mockCommand, ...prev]);
      setNewCommandName('');
      setNewCommandContent('');
      setShowShareForm(false);
      setIsSubmitting(false);
      return;
    }

    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id || null;

      const { data, error: insertError } = await supabase
        .from('popular_commands')
        .insert({
          name: newCommandName.trim(),
          content: newCommandContent.trim(),
          contributed_by: userId,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Add to local state.
      if (data) {
        setCommands(prev => [data, ...prev]);
      }

      // Reset form.
      setNewCommandName('');
      setNewCommandContent('');
      setShowShareForm(false);
    } catch (err) {
      console.error('Failed to submit command:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to share command');
    } finally {
      setIsSubmitting(false);
    }
  }, [newCommandName, newCommandContent]);

  // Render a single command row.
  const renderCommandRow = (command: Command, index: number, isTop: boolean) => {
    const isCopied = copiedId === command.id;
    
    return (
      <div
        key={command.id}
        onClick={() => handleCopy(command)}
        style={{
          ...styles.commandRow,
          backgroundColor: isCopied 
            ? (theme.isDark ? '#064e3b' : '#d1fae5')
            : (theme.isDark ? '#2d2d2d' : '#fff'),
          borderColor: isCopied
            ? (theme.isDark ? '#10b981' : '#34d399')
            : (theme.isDark ? '#404040' : '#e5e7eb'),
          cursor: 'pointer',
        }}
      >
        <div style={styles.commandLeft}>
          {/* Rank badge for top 10 */}
          {isTop && (
            <span style={{
              ...styles.rankBadge,
              backgroundColor: index < 3 
                ? (theme.isDark ? '#fbbf24' : '#f59e0b')
                : (theme.isDark ? '#6b7280' : '#9ca3af'),
              color: index < 3 ? '#000' : '#fff',
            }}>
              {index + 1}
            </span>
          )}
          
          <div style={styles.commandInfo}>
            <span style={{
              ...styles.commandName,
              color: theme.text,
            }}>
              {command.name}
            </span>
            <span style={{
              ...styles.commandPreview,
              color: theme.textSecondary,
            }}>
              {truncateContent(command.content, 80)}
            </span>
          </div>
        </div>
        
        <div style={styles.commandRight}>
          <span style={{
            ...styles.copyCount,
            color: theme.textSecondary,
          }}>
            {isCopied ? '✓ Copied' : `${command.copy_count} copies`}
          </span>
        </div>
      </div>
    );
  };

  // Loading state.
  if (loading) {
    return (
      <div style={{ ...styles.container, backgroundColor: theme.bg }}>
        <div style={styles.loading}>
          <span style={{ color: theme.textSecondary }}>Loading commands...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, backgroundColor: theme.bg }}>
      {/* Header with search and share */}
      <div style={styles.header}>
        <input
          type="text"
          placeholder="Search commands..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            ...styles.searchInput,
            backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
            borderColor: theme.isDark ? '#404040' : '#d1d5db',
            color: theme.text,
          }}
        />
        
        <button
          onClick={() => setShowShareForm(!showShareForm)}
          style={{
            ...styles.shareButton,
            backgroundColor: showShareForm 
              ? (theme.isDark ? '#4b5563' : '#d1d5db')
              : (theme.isDark ? '#3b82f6' : '#2563eb'),
            color: '#fff',
          }}
        >
          {showShareForm ? 'Cancel' : '+ Share'}
        </button>
      </div>

      {/* Share form (collapsible) */}
      {showShareForm && (
        <div style={{
          ...styles.shareForm,
          backgroundColor: theme.isDark ? '#1f2937' : '#f9fafb',
          borderColor: theme.isDark ? '#374151' : '#e5e7eb',
        }}>
          <input
            type="text"
            placeholder="Command name (e.g., 'refactor')"
            value={newCommandName}
            onChange={(e) => setNewCommandName(e.target.value)}
            style={{
              ...styles.formInput,
              backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
              borderColor: theme.isDark ? '#404040' : '#d1d5db',
              color: theme.text,
            }}
          />
          
          <textarea
            placeholder="Paste your command content here..."
            value={newCommandContent}
            onChange={(e) => setNewCommandContent(e.target.value)}
            rows={4}
            style={{
              ...styles.formTextarea,
              backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
              borderColor: theme.isDark ? '#404040' : '#d1d5db',
              color: theme.text,
            }}
          />
          
          {submitError && (
            <p style={styles.errorText}>{submitError}</p>
          )}
          
          <button
            onClick={handleSubmitCommand}
            disabled={isSubmitting || !newCommandName.trim() || !newCommandContent.trim()}
            style={{
              ...styles.submitButton,
              opacity: isSubmitting || !newCommandName.trim() || !newCommandContent.trim() ? 0.5 : 1,
              cursor: isSubmitting || !newCommandName.trim() || !newCommandContent.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Sharing...' : 'Share Command'}
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={fetchCommands} style={styles.retryButton}>Retry</button>
        </div>
      )}

      {/* Commands list */}
      <div style={styles.commandsList}>
        {filteredCommands.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={{ color: theme.textSecondary }}>
              {searchQuery ? 'No commands match your search' : 'No commands yet. Be the first to share!'}
            </span>
          </div>
        ) : (
          <>
            {/* Top 10 section */}
            {topCommands.length > 0 && (
              <div style={styles.section}>
                <h3 style={{ ...styles.sectionTitle, color: theme.textSecondary }}>
                  🔥 Top Commands
                </h3>
                {topCommands.map((cmd, idx) => renderCommandRow(cmd, idx, true))}
              </div>
            )}

            {/* Rest section */}
            {otherCommands.length > 0 && (
              <div style={styles.section}>
                <h3 style={{ ...styles.sectionTitle, color: theme.textSecondary }}>
                  More Commands
                </h3>
                {otherCommands.map((cmd, idx) => renderCommandRow(cmd, idx + 10, false))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Truncate content for preview.
function truncateContent(content: string, maxLength: number): string {
  const cleaned = content.replace(/\n+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

// Mock data for development/offline mode.
function getMockCommands(): Command[] {
  return [
    {
      id: 'mock-1',
      name: 'learn',
      content: 'Periodically you will learn something from talking to me. Document your learnings in a markdown file in the learnings/ directory.',
      copy_count: 42,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-2',
      name: 'refactor',
      content: 'Refactor the selected code to be more readable, maintainable, and follow best practices. Explain what changes you made and why.',
      copy_count: 38,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-3',
      name: 'review',
      content: 'Review this code for bugs, security issues, and opportunities for improvement. Be thorough and specific.',
      copy_count: 35,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-4',
      name: 'commit',
      content: 'Create a git commit with a clear, concise message following conventional commit standards.',
      copy_count: 31,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'mock-5',
      name: 'pr',
      content: 'Create a pull request with a clear description of changes, testing done, and any relevant context.',
      copy_count: 28,
      contributed_by: null,
      created_at: new Date().toISOString(),
    },
  ];
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  header: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
  },
  searchInput: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
  },
  shareButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  shareForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
  },
  formInput: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
  },
  formTextarea: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'monospace',
    minHeight: '80px',
  },
  submitButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  errorText: {
    fontSize: '13px',
    color: '#ef4444',
    margin: 0,
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontSize: '13px',
  },
  retryButton: {
    padding: '4px 12px',
    fontSize: '12px',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commandsList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 16px',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '8px',
    marginTop: 0,
  },
  commandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    marginBottom: '6px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    transition: 'background-color 0.15s, border-color 0.15s',
  },
  commandLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
  },
  rankBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: 600,
    flexShrink: 0,
  },
  commandInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  commandName: {
    fontSize: '13px',
    fontWeight: 600,
  },
  commandPreview: {
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  commandRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
    marginLeft: '12px',
  },
  copyCount: {
    fontSize: '12px',
    fontWeight: 500,
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '200px',
    fontSize: '13px',
  },
};
