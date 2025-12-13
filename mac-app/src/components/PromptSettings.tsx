// =============================================================================
// PromptSettings - Dedicated page for customizing the Engineer system prompt.
// Shows an example transcription, the improved version, and allows editing
// the system prompt that controls how transcriptions are refined.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Default example input - a messy transcription to demonstrate the Engineer feature.
 */
const EXAMPLE_INPUT = `ok so i need you to help me with this thing where like the database is slow and i think its the queries but maybe also the indexes idk. we're using postgres and its a rails app. users are complaining about load times especially on the dashboard page where we show all their recent activity and also the search is really slow too.`;

/**
 * Default example output - shows what the Engineer feature produces.
 */
const EXAMPLE_OUTPUT = `### Goal
Diagnose and resolve performance issues in a PostgreSQL database powering a Rails application.

### Context
- Database: PostgreSQL
- Framework: Rails
- Symptoms: Slow database performance causing user complaints
- Affected areas: Dashboard page (recent activity display) and search functionality
- Suspected causes: Inefficient queries, possibly missing or suboptimal indexes

### Task
1. Identify the slow queries causing performance degradation on dashboard and search
2. Analyze query execution plans using EXPLAIN ANALYZE
3. Recommend specific index additions or modifications
4. Suggest query optimizations if applicable
5. Consider caching strategies for frequently accessed data

### Constraints
- Solution must be compatible with Rails ActiveRecord conventions
- Minimize downtime during any proposed changes
- Prioritize fixes by user impact (dashboard > search)

### Output Format
Provide recommendations as a prioritized list with:
- The specific issue identified
- The proposed fix
- Expected performance impact
- Implementation steps`;

/**
 * PromptSettings component - Page for customizing prompt improvement behavior.
 */
export default function PromptSettings() {
  const { theme } = useTheme();
  
  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Track if user has unsaved changes
  const [hasChanges, setHasChanges] = useState(false);
  
  // Example section state
  const [showExample, setShowExample] = useState(true);
  
  // Load current system prompt on mount
  useEffect(() => {
    const loadPrompt = async () => {
      if (!window.clipboardAPI?.getSystemPrompt) {
        setError('System prompt API not available');
        setLoading(false);
        return;
      }
      
      try {
        const result = await window.clipboardAPI.getSystemPrompt();
        setSystemPrompt(result.prompt);
        setOriginalPrompt(result.prompt);
        setIsCustom(result.isCustom);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load system prompt');
        setLoading(false);
      }
    };
    
    loadPrompt();
  }, []);
  
  // Track changes to the prompt
  useEffect(() => {
    setHasChanges(systemPrompt !== originalPrompt);
  }, [systemPrompt, originalPrompt]);
  
  // Clear success message after a delay
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);
  
  // Save the custom system prompt
  const handleSave = useCallback(async () => {
    if (!window.clipboardAPI?.setSystemPrompt) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const result = await window.clipboardAPI.setSystemPrompt(systemPrompt);
      if (result.success) {
        setOriginalPrompt(systemPrompt);
        setIsCustom(true);
        setHasChanges(false);
        setSuccessMessage('System prompt saved successfully!');
      } else {
        setError(result.error || 'Failed to save system prompt');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save system prompt');
    } finally {
      setSaving(false);
    }
  }, [systemPrompt]);
  
  // Reset to default system prompt
  const handleReset = useCallback(async () => {
    if (!window.clipboardAPI?.resetSystemPrompt || !window.clipboardAPI?.getDefaultSystemPrompt) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const resetResult = await window.clipboardAPI.resetSystemPrompt();
      if (resetResult.success) {
        const defaultResult = await window.clipboardAPI.getDefaultSystemPrompt();
        setSystemPrompt(defaultResult.prompt);
        setOriginalPrompt(defaultResult.prompt);
        setIsCustom(false);
        setHasChanges(false);
        setSuccessMessage('Reset to default system prompt');
      } else {
        setError(resetResult.error || 'Failed to reset system prompt');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset system prompt');
    } finally {
      setSaving(false);
    }
  }, []);
  
  // Discard unsaved changes
  const handleDiscard = useCallback(() => {
    setSystemPrompt(originalPrompt);
    setHasChanges(false);
  }, [originalPrompt]);
  
  if (loading) {
    return (
      <div style={styles.container}>
        <p style={{ fontSize: '13px', color: '#6b7280' }}>Loading...</p>
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      {/* Collapsible example row */}
      <div style={styles.row} onClick={() => setShowExample(!showExample)}>
        <span style={styles.rowLabel}>
          {showExample ? '▼' : '▶'} Example
        </span>
        <span style={{ ...styles.rowValue, color: '#9ca3af' }}>
          {showExample ? 'Hide' : 'Show before/after'}
        </span>
      </div>
      
      {showExample && (
        <div style={styles.exampleContainer}>
          <div style={styles.exampleBox}>
            <div style={styles.exampleLabel}>🎤 Input</div>
            <div style={styles.exampleContent}>{EXAMPLE_INPUT}</div>
          </div>
          <div style={styles.arrow}>↓</div>
          <div style={{ ...styles.exampleBox, borderColor: '#a5b4fc' }}>
            <div style={styles.exampleLabel}>✨ Output</div>
            <pre style={styles.preformatted}>{EXAMPLE_OUTPUT}</pre>
          </div>
        </div>
      )}
      
      {/* System prompt editor */}
      <div style={styles.editorSection}>
        <div style={styles.row}>
          <span style={styles.rowLabel}>System Prompt</span>
          <div style={styles.rowControls}>
            {isCustom && <span style={styles.customBadge}>Custom</span>}
            {hasChanges && <span style={styles.unsavedIndicator}>●</span>}
          </div>
        </div>
        
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          style={styles.textarea}
          placeholder="Enter your custom system prompt..."
          spellCheck={false}
        />
        
        <div style={styles.actions}>
          {hasChanges && (
            <button onClick={handleDiscard} style={styles.btn} disabled={saving}>
              Discard
            </button>
          )}
          {isCustom && (
            <button onClick={handleReset} style={styles.btn} disabled={saving}>
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: saving || !hasChanges ? 0.5 : 1 }}
            disabled={saving || !hasChanges}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        
        {error && <p style={styles.error}>{error}</p>}
        {successMessage && <p style={styles.success}>{successMessage}</p>}
      </div>
    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 0,
  },
  
  // Flat row layout.
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    minHeight: '32px',
    cursor: 'pointer',
  },
  rowLabel: {
    fontSize: '13px',
    color: '#374151',
    fontWeight: 400,
  },
  rowValue: {
    fontSize: '13px',
    color: '#111827',
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  // Example section (collapsible).
  exampleContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '12px',
  },
  exampleBox: {
    backgroundColor: '#fff',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    padding: '10px',
  },
  exampleLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '4px',
  },
  exampleContent: {
    fontSize: '10px',
    color: '#374151',
    lineHeight: 1.5,
  },
  preformatted: {
    margin: 0,
    fontFamily: 'inherit',
    fontSize: '10px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.5,
    color: '#374151',
  },
  arrow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    color: '#9ca3af',
  },
  
  // Editor section.
  editorSection: {
    marginTop: '4px',
  },
  textarea: {
    width: '100%',
    minHeight: '160px',
    padding: '10px',
    fontSize: '10px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: 1.5,
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    resize: 'vertical',
    boxSizing: 'border-box',
    outline: 'none',
  },
  
  // Action buttons.
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '8px',
  },
  btn: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  btnPrimary: {
    color: '#fff',
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  
  // Badges and indicators.
  customBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#7c3aed',
    backgroundColor: '#ede9fe',
    padding: '2px 8px',
    borderRadius: '10px',
  },
  unsavedIndicator: {
    fontSize: '13px',
    color: '#f59e0b',
    fontWeight: 600,
  },
  
  // Error/success messages.
  error: {
    fontSize: '13px',
    color: '#dc2626',
    marginTop: '8px',
  },
  success: {
    fontSize: '13px',
    color: '#059669',
    marginTop: '8px',
  },
};
