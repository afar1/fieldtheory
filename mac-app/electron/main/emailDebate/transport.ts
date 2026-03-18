/**
 * Email transport helpers and SMTP/IMAP entrypoints for email debate.
 *
 * The plain-text formatting stays minimal on purpose so the resulting emails
 * read like normal email, not like generated HTML reports.
 */

import { ImapFlow } from 'imapflow';
import { createLogger } from '../logger';
import type { ImapConfig, SmtpConfig } from './types';

const log = createLogger('EmailTransport');
// nodemailer does not ship local typings in this workspace setup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require('nodemailer') as {
  createTransport: (options: unknown) => {
    sendMail: (mail: unknown) => Promise<{ messageId?: string }>;
    verify: () => Promise<void>;
    close: () => void;
  };
};

export interface DebateEmailMessage {
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
}

export interface IncomingReply {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string;
  subject: string;
  body: string;
  date: Date;
}

export async function sendDebateEmail(
  smtp: SmtpConfig,
  message: DebateEmailMessage
): Promise<string> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  try {
    const info = await transport.sendMail({
      from: `"${message.fromName}" <${message.from}>`,
      to: message.to.join(', '),
      subject: message.subject,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.references.length > 0 ? message.references.join(' ') : undefined,
      text: message.body,
    });

    log.info(
      'Email sent: %s -> %s (messageId: %s)',
      message.fromName,
      message.to.join(', '),
      info.messageId
    );

    return info.messageId ?? message.messageId;
  } finally {
    transport.close();
  }
}

export async function testSmtpConnection(smtp: SmtpConfig): Promise<boolean> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  try {
    await transport.verify();
    return true;
  } finally {
    transport.close();
  }
}

export async function pollForReplies(
  imap: ImapConfig,
  threadRootMessageIds: string[],
  knownMessageIds: Set<string>,
  sinceDaysAgo = 7
): Promise<IncomingReply[]> {
  if (threadRootMessageIds.length === 0) {
    return [];
  }

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });

  const replies: IncomingReply[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const since = new Date();
      since.setDate(since.getDate() - sinceDaysAgo);

      const results = client.fetch(
        { since },
        {
          envelope: true,
          headers: ['message-id', 'in-reply-to', 'references'],
          source: false,
          bodyStructure: true,
        }
      );

      for await (const message of results) {
        const envelope = message.envelope;
        if (!envelope) {
          continue;
        }

        const headersRaw = message.headers?.toString('utf-8') ?? '';
        const messageId = extractHeader(headersRaw, 'message-id');
        const inReplyTo = extractHeader(headersRaw, 'in-reply-to');
        const references =
          extractHeader(headersRaw, 'references')
            ?.split(/\s+/)
            .filter(Boolean) ?? [];

        if (!messageId || knownMessageIds.has(messageId)) {
          continue;
        }

        const isOurThread =
          references.some((ref) => threadRootMessageIds.includes(ref)) ||
          (inReplyTo != null &&
            threadRootMessageIds.some((rootMessageId) => inReplyTo.includes(rootMessageId)));

        if (!isOurThread) {
          continue;
        }

        const bodyText = await fetchMessageBody(client, message.uid);
        const fromAddress = envelope.from?.[0];
        replies.push({
          messageId,
          inReplyTo,
          references,
          from: fromAddress?.address ?? 'unknown',
          fromName: fromAddress?.name ?? 'Unknown',
          subject: envelope.subject ?? '',
          body: stripQuotedReply(bodyText),
          date: envelope.date ?? new Date(),
        });
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    log.error('IMAP poll error: %s', error);
  } finally {
    await client.logout().catch(() => {});
  }

  return replies;
}

export async function testImapConnection(imap: ImapConfig): Promise<boolean> {
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (error) {
    throw error;
  }
}

async function fetchMessageBody(client: ImapFlow, uid: number): Promise<string> {
  try {
    const downloaded = await client.download(String(uid), undefined, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.content) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString('utf-8');
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      return raw.substring(headerEnd + 4);
    }

    return raw;
  } catch {
    return '';
  }
}

function extractHeader(raw: string, name: string): string | null {
  const regex = new RegExp(`^${name}:\\s*(.+?)$`, 'im');
  const match = raw.match(regex);
  return match ? match[1].trim() : null;
}

export function stripQuotedReply(body: string): string {
  const markers = [
    /^On .+ wrote:$/m,
    /^-{3,}\s*Original Message\s*-{3,}$/m,
    /^>{2,}/m,
    /^From:\s/m,
  ];

  let cleanBody = body;
  for (const marker of markers) {
    const match = cleanBody.match(marker);
    if (match?.index != null && match.index > 0) {
      cleanBody = cleanBody.substring(0, match.index);
      break;
    }
  }

  return cleanBody.trim();
}

export function formatDebatePlainText(markdown: string, speakerName: string): string {
  const cleaned = markdown.trim();
  const lines = [
    `${speakerName}`,
    '',
    cleaned,
    '',
    '--',
    'Reply to this email to join the debate.',
  ];

  return lines.join('\n');
}

export function generateMessageId(threadId: string, turnNumber: number): string {
  return `<council-${threadId}-turn-${turnNumber}@fieldtheory.app>`;
}

export function generateRootMessageId(threadId: string): string {
  return `<council-${threadId}-root@fieldtheory.app>`;
}
