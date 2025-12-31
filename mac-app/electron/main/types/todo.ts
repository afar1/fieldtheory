/**
 * IPC channels for todo functionality.
 * Todos sync bidirectionally with Supabase (iOS ↔ Mac).
 */
export const TodoIPCChannels = {
  // Renderer -> Main (invoke/handle pattern)
  GET_TODOS: 'todo:getTodos',
  SYNC_TODOS: 'todo:syncTodos',
  CREATE_TODO: 'todo:createTodo',
  UPDATE_TODO: 'todo:updateTodo',
  TOGGLE_TODO: 'todo:toggleTodo',
  DELETE_TODO: 'todo:deleteTodo',
  DELETE_TODOS: 'todo:deleteTodos',
  COMPLETE_TODOS: 'todo:completeTodos',
  
  // Hotkey configuration
  GET_TODO_HOTKEY: 'todo:getHotkey',
  SET_TODO_HOTKEY: 'todo:setHotkey',
  
  // Main -> Renderer (send pattern)
  TODOS_CHANGED: 'todo:todosChanged',
  SHOW_TODOS: 'todo:showTodos',
  
  // Realtime events (granular updates from Supabase subscription)
  TODO_ADDED: 'todo:todoAdded',
  TODO_UPDATED: 'todo:todoUpdated',
  TODO_DELETED: 'todo:todoDeleted',
} as const;

/**
 * Todo item synced from Supabase.
 */
export interface Todo {
  id: string;           // Supabase UUID
  clientId: string;     // Client-generated ID for deduplication
  text: string;
  completed: boolean;
  createdAt: number;    // client_created_at_ms
  updatedAt: number;    // Parsed from updated_at
}

/**
 * Todo API exposed to renderer.
 */
export interface TodoAPI {
  getTodos: () => Promise<Todo[]>;
  syncTodos: () => Promise<Todo[]>;
  createTodo: (text: string) => Promise<Todo | null>;
  updateTodo: (id: string, text: string) => Promise<Todo | null>;
  toggleTodo: (id: string) => Promise<Todo | null>;
  deleteTodo: (id: string) => Promise<boolean>;
  deleteTodos: (ids: string[]) => Promise<boolean>;
  completeTodos: (ids: string[]) => Promise<boolean>;
  getHotkey: () => Promise<string>;
  setHotkey: (hotkey: string) => Promise<boolean>;
  onTodosChanged: (callback: (todos: Todo[]) => void) => () => void;
  onShowTodos: (callback: () => void) => () => void;
  onTodoAdded?: (callback: (todo: Todo) => void) => () => void;
  onTodoUpdated?: (callback: (todo: Todo) => void) => () => void;
  onTodoDeleted?: (callback: (id: string) => void) => () => void;
}

