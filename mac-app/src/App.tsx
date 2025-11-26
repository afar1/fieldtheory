import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import AudioSettingsPanel from './components/AudioSettingsPanel';
import TranscriptionSettings from './components/TranscriptionSettings';

const formatTime = (iso: string) => new Date(iso).toLocaleString();

// Available tabs in the app.
type TabId = 'data' | 'audio' | 'transcription';

type TodoRow = {
  id: string;
  text: string;
  completed: boolean;
  client_created_at_ms: number;
  updated_at: string;
};

type ObservationRow = {
  id: string;
  text: string;
  client_created_at_ms: number;
  updated_at: string;
};

type TranscriptRow = {
  id: string;
  text: string;
  client_created_at_ms: number;
  updated_at: string;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('data');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSendOtp = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage('Enter an email first.');
      return;
    }
    setIsSending(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed.toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setMessage('Code sent. Check your inbox.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to send code.';
      setMessage(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedEmail = email.trim();
    const trimmedOtp = otp.trim();
    if (!trimmedEmail || !trimmedOtp) {
      setMessage('Provide email + code.');
      return;
    }
    setIsVerifying(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: trimmedEmail.toLowerCase(),
        token: trimmedOtp,
        type: 'email',
      });
      if (error) throw error;
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setOtp('');
      setMessage('Signed in.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to verify code.';
      setMessage(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setTodos([]);
    setObservations([]);
    setTranscripts([]);
  };

  const fetchLists = async () => {
    if (!session) {
      setMessage('Sign in to fetch data.');
      return;
    }
    setIsRefreshing(true);
    setMessage(null);
    try {
      const [todosRes, obsRes, transcriptsRes] = await Promise.all([
        supabase.from('todos').select('*').order('updated_at', { ascending: false }),
        supabase.from('observations').select('*').order('updated_at', { ascending: false }),
        supabase.from('transcripts').select('*').order('updated_at', { ascending: false }),
      ]);

      if (todosRes.error) throw todosRes.error;
      if (obsRes.error) throw obsRes.error;
      if (transcriptsRes.error) throw transcriptsRes.error;

      setTodos(todosRes.data ?? []);
      setObservations(obsRes.data ?? []);
      setTranscripts(transcriptsRes.data ?? []);
      setMessage('Lists refreshed.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to refresh lists.';
      setMessage(msg);
    } finally {
      setIsRefreshing(false);
    }
  };

  const summary = useMemo(() => {
    const totalTodos = todos.length;
    const completed = todos.filter((todo) => todo.completed).length;
    return `${completed}/${totalTodos} todos complete`;
  }, [todos]);

  return (
    <div style={styles.root}>
      {/* Tab navigation */}
      <div style={styles.tabBar}>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'data' ? styles.tabButtonActive : {}),
          }}
          onClick={() => setActiveTab('data')}
        >
          Data
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'audio' ? styles.tabButtonActive : {}),
          }}
          onClick={() => setActiveTab('audio')}
        >
          Audio
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'transcription' ? styles.tabButtonActive : {}),
          }}
          onClick={() => setActiveTab('transcription')}
        >
          Transcription
        </button>
      </div>

      {/* Audio settings tab */}
      {activeTab === 'audio' && (
        <div style={styles.tabContent}>
          <AudioSettingsPanel />
        </div>
      )}

      {/* Transcription settings tab */}
      {activeTab === 'transcription' && (
        <div style={styles.tabContent}>
          <TranscriptionSettings />
        </div>
      )}

      {/* Data tab (original content) */}
      {activeTab === 'data' && (
      <div style={styles.dataTabContent}>
      <div style={styles.card}>
        <h1 style={{ marginTop: 0 }}>Little AI Companion</h1>
        {session ? (
          <p>Signed in as {session.user.email}</p>
        ) : (
          <p>Enter your email to request a 6-digit code.</p>
        )}

        <label style={styles.label}>
          Email
          <input
            style={styles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {!session && (
          <>
            <button style={styles.primaryButton} onClick={handleSendOtp} disabled={isSending}>
              {isSending ? 'Sending…' : 'Send Code'}
            </button>

            <label style={styles.label}>
              Code
              <input
                style={styles.input}
                type="text"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </label>

            <button style={styles.primaryButton} onClick={handleVerifyOtp} disabled={isVerifying}>
              {isVerifying ? 'Verifying…' : 'Verify & Sign In'}
            </button>
          </>
        )}

        {session && (
          <>
            <button style={styles.primaryButton} onClick={fetchLists} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button style={styles.secondaryButton} onClick={handleSignOut}>Sign Out</button>
            <p>{summary}</p>
          </>
        )}

        {message && <p style={styles.message}>{message}</p>}
      </div>

      {session && (
        <div style={styles.listsContainer}>
          <section style={styles.listSection}>
            <h2>Todos</h2>
            {todos.length === 0 && <p>No todos yet.</p>}
            <ul>
              {todos.map((todo) => (
                <li key={todo.id} style={styles.listItem}>
                  <div>
                    <strong>{todo.text}</strong>
                    <div style={styles.metaRow}>
                      <span>{todo.completed ? 'Done' : 'Open'}</span>
                      <span>{formatTime(todo.updated_at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section style={styles.listSection}>
            <h2>Observations</h2>
            {observations.length === 0 && <p>No observations yet.</p>}
            <ul>
              {observations.map((observation) => (
                <li key={observation.id} style={styles.listItem}>
                  <strong>{observation.text}</strong>
                  <div style={styles.metaRow}>{formatTime(observation.updated_at)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section style={styles.listSection}>
            <h2>Transcripts</h2>
            {transcripts.length === 0 && <p>No transcripts yet.</p>}
            <ul>
              {transcripts.map((transcript) => (
                <li key={transcript.id} style={styles.listItem}>
                  <p style={{ margin: '0 0 4px' }}>{transcript.text}</p>
                  <div style={styles.metaRow}>{formatTime(transcript.updated_at)}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    alignItems: 'flex-start',
    backgroundColor: '#f5f5f5',
  },
  tabBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  },
  tabButton: {
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  tabButtonActive: {
    backgroundColor: '#111827',
    color: '#fff',
    borderColor: '#111827',
  },
  tabContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '16px',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.1)',
  },
  dataTabContent: {
    display: 'flex',
    gap: '24px',
    alignItems: 'flex-start',
    width: '100%',
  },
  card: {
    width: '320px',
    padding: '24px',
    borderRadius: '16px',
    backgroundColor: '#fff',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.1)',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 600,
    marginTop: '16px',
  },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px',
    fontSize: '14px',
  },
  primaryButton: {
    width: '100%',
    marginTop: '16px',
    padding: '12px',
    borderRadius: '10px',
    border: 'none',
    backgroundColor: '#111827',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    marginTop: '8px',
    padding: '10px',
    borderRadius: '10px',
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    color: '#111827',
    fontWeight: 600,
    cursor: 'pointer',
  },
  message: {
    marginTop: '16px',
    fontSize: '14px',
    color: '#374151',
  },
  listsContainer: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
  },
  listSection: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.08)',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  listItem: {
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    marginBottom: '10px',
    listStyle: 'none',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#6b7280',
  },
};
