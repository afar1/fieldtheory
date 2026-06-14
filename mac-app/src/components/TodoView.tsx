// =============================================================================
// TodoView - Keyboard-first internal todo sync surface.
// Hidden unless Field Theory sync is explicitly enabled.
// =============================================================================

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

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
 * Format timestamp to date/time in user's local timezone.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const date = new Date(timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const taskDate = new Date(date);
  taskDate.setHours(0, 0, 0, 0);
  
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  if (taskDate.getTime() === today.getTime()) {
    return `Today ${timeStr}`;
  } else if (taskDate.getTime() === yesterday.getTime()) {
    return `Yesterday ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    return `${dateStr}, ${timeStr}`;
  }
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
  const [showCompleted, setShowCompleted] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  
  // Editing state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  
  // Refs.
  const listRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sort todos: incomplete first (by creation date desc), then completed (by update date desc).
  const sortedTodos = useMemo(() => {
    const incomplete = todos.filter(t => !t.completed).sort((a, b) => b.createdAt - a.createdAt);
    const completed = todos.filter(t => t.completed).sort((a, b) => b.updatedAt - a.updatedAt);
    return [...incomplete, ...completed];
  }, [todos]);

  // Filter based on showCompleted toggle and search query.
  const visibleTodos = useMemo(() => {
    let filtered = sortedTodos;
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => t.text.toLowerCase().includes(query));
    }
    
    // Apply completed filter
    if (!showCompleted) {
      filtered = filtered.filter(t => !t.completed);
    }
    
    return filtered;
  }, [sortedTodos, showCompleted, searchQuery]);

  // Count of completed todos (for toggle label).
  const completedCount = useMemo(() => todos.filter(t => t.completed).length, [todos]);

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadTodos = useCallback(async () => {
    if (!window.todoAPI) return;
    
    try {
      setSyncing(true);
      
      // Check authentication.
      const authed = await window.todoAPI.isAuthenticated();
      setIsAuthenticated(authed);
      
      if (!authed) {
        setLoading(false);
        setSyncing(false);
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
    }
  }, []);

  useEffect(() => {
    if (todos.length === 0) {
      loadTodos();
    } else {
      // Check auth status even if we have cached data.
      (async () => {
        const authed = await window.todoAPI?.isAuthenticated();
        setIsAuthenticated(authed ?? false);
        setLoading(false);
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCache = useCallback((newTodos: Todo[]) => {
    try {
      localStorage.setItem('todosCache', JSON.stringify(newTodos));
    } catch (e) {
      console.error('[TodoView] Failed to cache todos:', e);
    }
  }, []);

  // Subscribe to realtime events.
  useEffect(() => {
    if (!window.todoAPI) return;
    
    // Handle bulk changes (from polling fallback or full sync).
    const unsubChanged = window.todoAPI.onTodosChanged((newTodos) => {
      setTodos(newTodos);
      updateCache(newTodos);
    });

    const unsubAdded = window.todoAPI.onTodoAdded?.((todo) => {
      setTodos(prev => {
        // Avoid duplicates.
        if (prev.some(t => t.id === todo.id)) return prev;
        const next = [todo, ...prev];
        updateCache(next);
        return next;
      });
    });

    const unsubUpdated = window.todoAPI.onTodoUpdated?.((todo) => {
      setTodos(prev => {
        const next = prev.map(t => t.id === todo.id ? todo : t);
        updateCache(next);
        return next;
      });
    });

    const unsubDeleted = window.todoAPI.onTodoDeleted?.((id) => {
      setTodos(prev => {
        const next = prev.filter(t => t.id !== id);
        updateCache(next);
        return next;
      });
    });
    
    return () => {
      unsubChanged?.();
      unsubAdded?.();
      unsubUpdated?.();
      unsubDeleted?.();
    };
  }, [updateCache]);

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
          Task sync is not available in this version of Field Theory.
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
      {/* Top area: Search + Create new */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px',
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder=""
            style={{
              width: '100%',
              padding: `6px 10px 6px ${!searchQuery && !searchFocused ? '32px' : '10px'}`,
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: '6px',
              fontSize: '11px',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: theme.inputBg,
              color: theme.text,
              transition: 'padding-left 0.1s ease',
            }}
          />
          {!searchQuery && !searchFocused && (
            <div style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              pointerEvents: 'none',
              color: theme.textSecondary,
              fontSize: '11px',
            }}>
              <span>search...</span>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setTimeout(() => createInputRef.current?.focus(), 0);
          }}
          style={{
            padding: '6px 8px',
            fontSize: '10px',
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          create new <KeyCap small>c</KeyCap>
        </button>
      </div>
      
      
      {/* Sync status indicator */}
      {syncing && (
        <div style={{
          marginBottom: '8px',
          fontSize: '10px',
          color: theme.textSecondary,
          opacity: 0.7,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
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
        </div>
      )}

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
                color: theme.error,
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
                  padding: '6px 10px',
                  marginBottom: '2px',
                  borderRadius: '6px',
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
                        fontSize: '12px',
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

      {/* Fixed bottom area: Refresh + Hide done - positioned above footer */}
      <div style={{
        position: 'fixed',
        bottom: '48px',
        left: '16px',
        right: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        backgroundColor: theme.bg,
        borderTop: `1px solid ${theme.border}`,
        zIndex: 10,
      }}>
        <button
          onClick={() => loadTodos()}
          disabled={syncing}
          style={{
            padding: '6px 8px',
            fontSize: '10px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: syncing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            opacity: syncing ? 0.5 : 1,
          }}
        >
          refresh <KeyCap small>r</KeyCap>
        </button>
        <button
          onClick={() => setShowCompleted(prev => !prev)}
          style={{
            padding: '6px 8px',
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
          hide done ({completedCount}) <KeyCap small>h</KeyCap>
        </button>
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
