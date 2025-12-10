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
        <div style={styles.loading}>Loading prompt settings...</div>
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Prompt Settings</h2>
      <p style={styles.description}>
        Customize how Oscar improves your transcriptions. The system prompt controls how your
        voice recordings are transformed into structured, actionable prompts.
      </p>
      
      {/* Example Section - Shows before/after demonstration */}
      <div style={styles.section}>
        <div 
          style={styles.sectionHeader}
          onClick={() => setShowExample(!showExample)}
        >
          <h3 style={styles.sectionTitle}>
            {showExample ? '▼' : '▶'} Example: Raw Transcription → Improved Prompt
          </h3>
          <span style={styles.toggleHint}>{showExample ? 'Hide' : 'Show'}</span>
        </div>
        
        {showExample && (
          <div style={styles.exampleContainer}>
            {/* Raw Input */}
            <div style={styles.exampleBox}>
              <div style={styles.exampleLabel}>
                <span style={styles.labelIcon}>🎤</span>
                Raw Transcription
              </div>
              <div style={styles.exampleContent}>{EXAMPLE_INPUT}</div>
            </div>
            
            {/* Arrow */}
            <div style={styles.arrow}>✨ →</div>
            
            {/* Improved Output */}
            <div style={{...styles.exampleBox, ...styles.improvedBox}}>
              <div style={styles.exampleLabel}>
                <span style={styles.labelIcon}>✨</span>
                Improved Prompt
              </div>
              <div style={styles.exampleContent}>
                <pre style={styles.preformatted}>{EXAMPLE_OUTPUT}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* System Prompt Editor */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>System Prompt</h3>
          {isCustom && (
            <span style={styles.customBadge}>Custom</span>
          )}
        </div>
        
        <p style={styles.sectionDescription}>
          This prompt tells the AI how to process your transcriptions. Edit it to change
          the output format, add specific instructions, or customize for your workflow.
        </p>
        
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          style={styles.textarea}
          placeholder="Enter your custom system prompt..."
          spellCheck={false}
        />
        
        {/* Action Buttons */}
        <div style={styles.actions}>
          <div style={styles.leftActions}>
            {hasChanges && (
              <span style={styles.unsavedIndicator}>● Unsaved changes</span>
            )}
          </div>
          
          <div style={styles.rightActions}>
            {hasChanges && (
              <button
                onClick={handleDiscard}
                style={styles.secondaryButton}
                disabled={saving}
              >
                Discard
              </button>
            )}
            
            {isCustom && (
              <button
                onClick={handleReset}
                style={styles.secondaryButton}
                disabled={saving}
              >
                Reset to Default
              </button>
            )}
            
            <button
              onClick={handleSave}
              style={{
                ...styles.primaryButton,
                ...(saving || !hasChanges ? styles.disabledButton : {}),
              }}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
        
        {/* Error/Success Messages */}
        {error && (
          <div style={styles.errorMessage}>{error}</div>
        )}
        {successMessage && (
          <div style={styles.successMessage}>{successMessage}</div>
        )}
      </div>
      
      {/* Tips Section */}
      <div style={styles.tipsSection}>
        <h4 style={styles.tipsTitle}>💡 Tips for Customization</h4>
        <ul style={styles.tipsList}>
          <li>Keep the output format section if you want consistent structure</li>
          <li>Add domain-specific context (e.g., "I work in healthcare" or "I'm a software engineer")</li>
          <li>Include examples relevant to your use case</li>
          <li>Specify any constraints or requirements you always need</li>
        </ul>
      </div>
    </div>
  );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#6b7280',
    fontSize: '14px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '8px',
    color: '#111',
  },
  description: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: 0,
    marginBottom: '24px',
    lineHeight: 1.5,
  },
  section: {
    marginBottom: '24px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#374151',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  toggleHint: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  sectionDescription: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: 0,
    marginBottom: '12px',
    lineHeight: 1.5,
  },
  customBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#7c3aed',
    backgroundColor: '#ede9fe',
    padding: '2px 8px',
    borderRadius: '10px',
  },
  exampleContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  exampleBox: {
    backgroundColor: '#fff',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  },
  improvedBox: {
    borderColor: '#a5b4fc',
    backgroundColor: '#fafbff',
  },
  exampleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: '#f3f4f6',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
  },
  labelIcon: {
    fontSize: '14px',
  },
  exampleContent: {
    padding: '12px',
    fontSize: '13px',
    color: '#374151',
    lineHeight: 1.6,
  },
  preformatted: {
    margin: 0,
    fontFamily: 'inherit',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  arrow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: '#6366f1',
    fontWeight: 500,
  },
  textarea: {
    width: '100%',
    minHeight: '300px',
    padding: '12px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: 1.6,
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    resize: 'vertical',
    boxSizing: 'border-box',
    outline: 'none',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '12px',
  },
  leftActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  rightActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  unsavedIndicator: {
    fontSize: '12px',
    color: '#f59e0b',
    fontWeight: 500,
  },
  primaryButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#f9fafb',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  errorMessage: {
    marginTop: '12px',
    padding: '10px 12px',
    fontSize: '13px',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
  },
  successMessage: {
    marginTop: '12px',
    padding: '10px 12px',
    fontSize: '13px',
    color: '#059669',
    backgroundColor: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: '6px',
  },
  tipsSection: {
    padding: '16px',
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    marginTop: '24px',
  },
  tipsTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#92400e',
    margin: '0 0 12px 0',
  },
  tipsList: {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '13px',
    color: '#78350f',
    lineHeight: 1.8,
  },
};
