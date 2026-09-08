import { formatVoiceInboxTime, type VoiceInboxNotePresentation } from '../../electron/shared/voiceInboxPresentation';
import { useTheme } from '../contexts/ThemeContext';
import { OpenVoiceTaskButton } from './OpenVoiceTaskButton';
import './VoiceInboxMetadata.css';

export function VoiceInboxMetadata({ note }: { note: VoiceInboxNotePresentation }) {
  const { theme } = useTheme();
  const captureTime = formatVoiceInboxTime(note.createdAtMs);
  const capturedAt = captureTime ? new Date(note.createdAtMs!) : null;
  const wordCount = note.wordCount.toLocaleString();
  const wordLabel = `${wordCount} ${note.wordCount === 1 ? 'word' : 'words'}`;

  return (
    <span className="voice-inbox-details" style={{ color: theme.textSecondary }}>
      <span className="voice-inbox-word-count" aria-label={wordLabel} title={wordLabel}>
        <span aria-hidden="true">{wordCount}<span className="voice-inbox-wide"> {note.wordCount === 1 ? 'word' : 'words'}</span><span className="voice-inbox-narrow">w</span></span>
      </span>
      {capturedAt && (
        <time dateTime={capturedAt.toISOString()} title={captureTime} aria-label={captureTime}>
          <span className="voice-inbox-wide" aria-hidden="true">{captureTime}</span>
          <svg className="voice-inbox-narrow voice-inbox-clock" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 10V6" transform={`rotate(${(capturedAt.getHours() % 12) * 30 + capturedAt.getMinutes() / 2} 10 10)`} />
            <path d="M10 10V4" transform={`rotate(${capturedAt.getMinutes() * 6} 10 10)`} />
          </svg>
        </time>
      )}
      {note.threadId && (
        <span className="voice-inbox-task"
          onKeyDown={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
          <OpenVoiceTaskButton threadId={note.threadId} compact />
        </span>
      )}
    </span>
  );
}
