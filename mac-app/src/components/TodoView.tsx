// =============================================================================
// TodoView - Keyboard-first todo list with bidirectional Supabase sync.
// Shows todos from iOS, allows marking complete, editing, deleting, creating.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';

// Todo type matches what MobileSync returns.
interface Todo {
  id: string;
  clientId: string;
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * KeyCap component - renders a keyboard key with clean styling.
 */
function KeyCap({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: small ? '1px 4px' : '2px 5px',
        fontSize: small ? '9px' : '10px',
        fontWeight: 500,
        color: '#555',
        backgroundColor: '#e8e8e8',
        borderRadius: '3px',
        marginRight: '2px',
      }}
    >
      {children}
    </span>
  );
}

/**
 * Format timestamp to relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

interface TodoViewProps {
  onSwitchToClipboard: () => void;
}

export default function TodoView({ onSwitchToClipboard }: TodoViewProps) {
  const { theme } = useTheme();
  
  // Core state - initialize from localStorage cache for instant display.
  const [todos, setTodos] = useState<Todo[]>(() => {
    try {
      const cached = localStorage.getItem('todosCache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.error('[TodoView] Failed to parse cached todos:', e);
    }
    return [];
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  
  // Editing state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  
  // Refs.
  const listRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Sort todos: incomplete first (by creation date desc), then completed (by update date desc).
  const sortedTodos = useMemo(() => {
    const incomplete = todos.filter(t => !t.completed).sort((a, b) => b.createdAt - a.createdAt);
    const completed = todos.filter(t => t.completed).sort((a, b) => b.updatedAt - a.updatedAt);
    return [...incomplete, ...completed];
  }, [todos]);

  // Filter based on showCompleted toggle.
  const visibleTodos = useMemo(() => {
    if (showCompleted) return sortedTodos;
    return sortedTodos.filter(t => !t.completed);
  }, [sortedTodos, showCompleted]);

  // Count of completed todos (for toggle label).
  const completedCount = useMemo(() => todos.filter(t => t.completed).length, [todos]);

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadTodos = useCallback(async (isBackgroundSync = false) => {
    if (!window.todoAPI) return;
    
    try {
      // Use background syncing if we have cached data, otherwise show loading state.
      if (isBackgroundSync) {
        setBackgroundSyncing(true);
      } else {
        setSyncing(true);
      }
      
      // Ensure session is passed to main process (in case it wasn't on app start).
      // This handles the case where user was already logged in from a previous session.
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await window.clipboardAPI?.setSyncSession?.(
            session.access_token,
            session.refresh_token
          );
        }
      }
      
      // Check authentication.
      const authed = await window.todoAPI.isAuthenticated();
      setIsAuthenticated(authed);
      
      if (!authed) {
        setLoading(false);
        setSyncing(false);
        setBackgroundSyncing(false);
        return;
      }
      
      const data = await window.todoAPI.syncTodos();
      setTodos(data);
      
      // Save to localStorage for future instant display.
      try {
        localStorage.setItem('todosCache', JSON.stringify(data));
      } catch (e) {
        console.error('[TodoView] Failed to cache todos:', e);
      }
    } catch (err) {
      console.error('[TodoView] Failed to sync todos:', err);
    } finally {
      setLoading(false);
      setSyncing(false);
      setBackgroundSyncing(false);
    }
  }, []);

  // Initial load - use background sync if we have cached data.
  useEffect(() => {
    const hasCachedData = todos.length > 0;
    loadTodos(hasCachedData);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for todo changes from other windows or sync.
  useEffect(() => {
    if (!window.todoAPI) return;
    
    const unsubscribe = window.todoAPI.onTodosChanged((newTodos) => {
      setTodos(newTodos);
    });
    
    return () => unsubscribe?.();
  }, []);

  // ==========================================================================
  // Actions
  // ==========================================================================

  const handleToggle = useCallback(async (id: string) => {
    if (!window.todoAPI) return;
    
    // Optimistic update.
    setTodos(prev => prev.map(t => 
      t.id === id ? { ...t, completed: !t.completed, updatedAt: Date.now() } : t
    ));
    
    try {
      await window.todoAPI.toggleTodo(id);
    } catch (err) {
      console.error('[TodoView] Failed to toggle todo:', err);
      loadTodos(); // Revert on error.
    }
  }, [loadTodos]);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.todoAPI) return;
    
    // Optimistic update.
    setTodos(prev => prev.filter(t => t.id !== id));
    
    try {
      await window.todoAPI.deleteTodo(id);
    } catch (err) {
      console.error('[TodoView] Failed to delete todo:', err);
      loadTodos();
    }
  }, [loadTodos]);

  const handleDeleteSelected = useCallback(async () => {
    if (!window.todoAPI || selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    
    // Optimistic update.
    setTodos(prev => prev.filter(t => !selectedIds.has(t.id)));
    setSelectedIds(new Set());
    
    try {
      await window.todoAPI.deleteTodos(ids);
    } catch (err) {
      console.error('[TodoView] Failed to delete todos:', err);
      loadTodos();
    }
  }, [selectedIds, loadTodos]);

  const handleCompleteSelected = useCallback(async () => {
    if (!window.todoAPI || selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    
    // Optimistic update.
    setTodos(prev => prev.map(t => 
      selectedIds.has(t.id) ? { ...t, completed: true, updatedAt: Date.now() } : t
    ));
    setSelectedIds(new Set());
    
    try {
      await window.todoAPI.completeTodos(ids);
    } catch (err) {
      console.error('[TodoView] Failed to complete todos:', err);
      loadTodos();
    }
  }, [selectedIds, loadTodos]);

  const handleCreate = useCallback(async () => {
    if (!window.todoAPI || !newTodoText.trim()) return;
    
    const text = newTodoText.trim();
    setNewTodoText('');
    setIsCreating(false);
    
    try {
      // Create the todo - the onTodosChanged callback will add it to state.
      // We don't add optimistically here to avoid duplicates since createTodo
      // already emits a todosChanged event with the updated list.
      await window.todoAPI.createTodo(text);
      setSelectedIndex(0);
    } catch (err) {
      console.error('[TodoView] Failed to create todo:', err);
    }
  }, [newTodoText]);

  const handleSaveEdit = useCallback(async () => {
    if (!window.todoAPI || !editingId || !editText.trim()) return;
    
    const id = editingId;
    const text = editText.trim();
    setEditingId(null);
    setEditText('');
    
    // Optimistic update.
    setTodos(prev => prev.map(t => 
      t.id === id ? { ...t, text, updatedAt: Date.now() } : t
    ));
    
    try {
      await window.todoAPI.updateTodo(id, text);
    } catch (err) {
      console.error('[TodoView] Failed to update todo:', err);
      loadTodos();
    }
  }, [editingId, editText, loadTodos]);

  const startEditing = useCallback((todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const startCreating = useCallback(() => {
    setIsCreating(true);
    setNewTodoText('');
  }, []);

  const cancelCreating = useCallback(() => {
    setIsCreating(false);
    setNewTodoText('');
  }, []);

  // Focus edit input when editing starts.
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Focus create input when creating starts.
  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreating]);

  // ==========================================================================
  // Keyboard Navigation
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when editing or creating.
      if (editingId || isCreating) {
        // Handle Escape to cancel.
        if (e.key === 'Escape') {
          e.preventDefault();
          if (editingId) cancelEditing();
          if (isCreating) cancelCreating();
        }
        // Handle Cmd+Enter to save edit.
        if (e.key === 'Enter' && e.metaKey && editingId) {
          e.preventDefault();
          handleSaveEdit();
        }
        // Handle Enter to create.
        if (e.key === 'Enter' && !e.metaKey && isCreating) {
          e.preventDefault();
          handleCreate();
        }
        return;
      }

      const currentTodo = visibleTodos[selectedIndex];

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) {
            // Multi-select: extend selection downward.
            if (currentTodo) {
              setSelectedIds(prev => {
                const next = new Set(prev);
                next.add(currentTodo.id);
                return next;
              });
            }
          }
          setSelectedIndex(prev => Math.min(prev + 1, visibleTodos.length - 1));
          break;

        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) {
            // Multi-select: extend selection upward.
            if (currentTodo) {
              setSelectedIds(prev => {
                const next = new Set(prev);
                next.add(currentTodo.id);
                return next;
              });
            }
          }
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;

        case 'e':
          // Toggle complete/incomplete.
          e.preventDefault();
          if (selectedIds.size > 0) {
            handleCompleteSelected();
          } else if (currentTodo) {
            handleToggle(currentTodo.id);
          }
          break;

        case 'Enter':
          // Start editing.
          e.preventDefault();
          if (currentTodo && !currentTodo.completed) {
            startEditing(currentTodo);
          }
          break;

        case 'c':
          // Create new todo.
          e.preventDefault();
          startCreating();
          break;

        case 'Backspace':
        case 'Delete':
          // Delete.
          e.preventDefault();
          if (selectedIds.size > 0) {
            handleDeleteSelected();
          } else if (currentTodo) {
            handleDelete(currentTodo.id);
          }
          break;

        case 'Escape':
          // Clear selection or switch to clipboard view.
          e.preventDefault();
          if (selectedIds.size > 0) {
            setSelectedIds(new Set());
          } else {
            onSwitchToClipboard();
          }
          break;

        case 'Tab':
          // Switch to clipboard view.
          e.preventDefault();
          onSwitchToClipboard();
          break;

        case 'h':
          // Toggle show/hide completed.
          e.preventDefault();
          setShowCompleted(prev => !prev);
          break;

        case 'r':
          // Refresh/sync.
          e.preventDefault();
          loadTodos();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    visibleTodos, selectedIndex, selectedIds, editingId, isCreating,
    handleToggle, handleDelete, handleDeleteSelected, handleCompleteSelected,
    handleSaveEdit, handleCreate, startEditing, cancelEditing, startCreating, cancelCreating,
    onSwitchToClipboard, loadTodos
  ]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.textSecondary,
        fontSize: '13px',
      }}>
        Loading tasks...
      </div>
    );
  }

  // Show login prompt if not authenticated.
  if (isAuthenticated === false) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 32px',
        textAlign: 'center',
        gap: '16px',
      }}>
        <div style={{
          fontSize: '32px',
        }}>
          📱
        </div>
        <div style={{
          fontSize: '15px',
          fontWeight: 600,
          color: theme.text,
        }}>
          Sign in to sync tasks
        </div>
        <div style={{
          fontSize: '13px',
          color: theme.textSecondary,
          lineHeight: '1.5',
          maxWidth: '280px',
        }}>
          Go to <strong>Settings → Mobile Sync</strong> and sign in with your iOS app account to see your tasks here.
        </div>
        <div style={{
          display: 'flex',
          gap: '8px',
          marginTop: '8px',
        }}>
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            clipboard <KeyCap small>tab</KeyCap>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column', 
      overflow: 'hidden',
      padding: '0 16px 16px 16px',
    }}>
      {/* Header with toggle and sync status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        paddingTop: '4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ 
            fontSize: '13px', 
            fontWeight: 600, 
            color: theme.text,
          }}>
            Tasks
          </span>
          <span style={{ 
            fontSize: '11px', 
            color: theme.textSecondary,
          }}>
            {visibleTodos.length} {visibleTodos.length === 1 ? 'task' : 'tasks'}
          </span>
          {syncing && (
            <span style={{ fontSize: '10px', color: theme.accent }}>
              syncing...
            </span>
          )}
          {backgroundSyncing && !syncing && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: theme.textSecondary,
              opacity: 0.7,
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                border: '1.5px solid rgba(128,128,128,0.3)',
                borderTopColor: theme.accent,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              syncing
            </span>
          )}
        </div>
        
        {/* Show/hide completed toggle */}
        <button
          onClick={() => setShowCompleted(prev => !prev)}
          style={{
            padding: '4px 8px',
            fontSize: '10px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <KeyCap small>h</KeyCap>
          {showCompleted ? `Hide done (${completedCount})` : `Show done (${completedCount})`}
        </button>
      </div>

      {/* Create new todo input (shown when pressing 'c') */}
      {isCreating && (
        <div style={{
          marginBottom: '8px',
          padding: '8px 12px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
          borderRadius: '8px',
          border: `1px solid ${theme.accent}`,
        }}>
          <input
            ref={createInputRef}
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            placeholder="What needs to be done?"
            style={{
              width: '100%',
              padding: '6px 0',
              fontSize: '13px',
              color: theme.text,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginTop: '6px',
            fontSize: '10px',
            color: theme.textSecondary,
          }}>
            <span>create <KeyCap small>↵</KeyCap></span>
            <span>cancel <KeyCap small>esc</KeyCap></span>
          </div>
        </div>
      )}

      {/* Multi-select actions bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          marginBottom: '8px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
          borderRadius: '6px',
          fontSize: '11px',
        }}>
          <span style={{ fontWeight: 500, color: theme.text }}>
            {selectedIds.size} selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleCompleteSelected}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              done <KeyCap small>e</KeyCap>
            </button>
            <button
              onClick={handleDeleteSelected}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                color: '#ef4444',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              delete <KeyCap small>⌫</KeyCap>
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              clear <KeyCap small>esc</KeyCap>
            </button>
          </div>
        </div>
      )}

      {/* Todo list */}
      <div 
        ref={listRef}
        style={{ 
          flex: 1, 
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {visibleTodos.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: theme.textSecondary,
            fontSize: '13px',
            gap: '8px',
          }}>
            <span>No tasks yet</span>
            <span style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Press <KeyCap>c</KeyCap> to create one
            </span>
          </div>
        ) : (
          visibleTodos.map((todo, index) => {
            const isSelected = selectedIndex === index;
            const isInSelection = selectedIds.has(todo.id);
            const isEditing = editingId === todo.id;

            return (
              <div
                key={todo.id}
                data-index={index}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => !todo.completed && startEditing(todo)}
                style={{
                  padding: '10px 12px',
                  marginBottom: '4px',
                  borderRadius: '8px',
                  backgroundColor: isSelected 
                    ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
                    : isInSelection
                    ? (theme.isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)')
                    : 'transparent',
                  border: isSelected 
                    ? `1px solid ${theme.accent}` 
                    : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                }}
              >
                {isEditing ? (
                  // Inline edit mode.
                  <div>
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 0',
                        fontSize: '13px',
                        color: theme.text,
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                      }}
                    />
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      marginTop: '6px',
                      fontSize: '10px',
                      color: theme.textSecondary,
                    }}>
                      <span>save <KeyCap small>⌘</KeyCap><KeyCap small>↵</KeyCap></span>
                      <span>cancel <KeyCap small>esc</KeyCap></span>
                    </div>
                  </div>
                ) : (
                  // Normal display mode.
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    {/* Checkbox */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle(todo.id);
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        border: `2px solid ${todo.completed ? theme.accent : theme.border}`,
                        backgroundColor: todo.completed ? theme.accent : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      {todo.completed && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px',
                        color: todo.completed ? theme.textSecondary : theme.text,
                        textDecoration: todo.completed ? 'line-through' : 'none',
                        lineHeight: '1.4',
                        wordBreak: 'break-word',
                      }}>
                        {todo.text}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: theme.textSecondary,
                        marginTop: '4px',
                        opacity: 0.7,
                      }}>
                        {formatRelativeTime(todo.createdAt)}
                      </div>
                    </div>

                    {/* Action hints (show on selection) */}
                    {isSelected && !todo.completed && (
                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        fontSize: '10px',
                        color: theme.textSecondary,
                        flexShrink: 0,
                      }}>
                        <span>done <KeyCap small>e</KeyCap></span>
                        <span>edit <KeyCap small>↵</KeyCap></span>
                      </div>
                    )}
                    {isSelected && todo.completed && (
                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        fontSize: '10px',
                        color: theme.textSecondary,
                        flexShrink: 0,
                      }}>
                        <span>undo <KeyCap small>e</KeyCap></span>
                        <span>delete <KeyCap small>⌫</KeyCap></span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer with keyboard shortcuts */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '8px',
        borderTop: `1px solid ${theme.border}`,
        fontSize: '10px',
        color: theme.textSecondary,
      }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span>navigate <KeyCap small>j</KeyCap><KeyCap small>k</KeyCap></span>
          <span>create <KeyCap small>c</KeyCap></span>
          <span>toggle <KeyCap small>e</KeyCap></span>
          <span>refresh <KeyCap small>r</KeyCap></span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span>multi-select <KeyCap small>⇧</KeyCap><KeyCap small>j</KeyCap><KeyCap small>k</KeyCap></span>
          <span>clipboard <KeyCap small>tab</KeyCap></span>
        </div>
      </div>

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

