#!/usr/bin/env node
/**
 * theories-send-email.js — Send Theories digests via AgentMail.
 *
 * Reads config from .env.local files:
 *   EMAIL_DEBATE_AGENTMAIL_API_KEY  — required (shared with mac app)
 *   EMAIL_DEBATE_AGENTMAIL_DOMAIN   — optional, defaults to agentmail.to
 *
 * Usage:
 *   node theories-send-email.js "Subject" "to@example.com" /path/to/body.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Load .env.local from CLI dir, repo root, and mac-app
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
loadDotenv({ path: path.join(scriptDir, '.env.local') });
loadDotenv({ path: path.join(scriptDir, '..', '..', '.env.local') });
loadDotenv({ path: path.join(scriptDir, '..', '..', 'mac-app', '.env.local') });

// ── Markdown → HTML ──────────────────────────────────────────────────────
function markdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="margin: 16px 0 8px; font-size: 16px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin: 20px 0 8px; font-size: 18px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin: 24px 0 12px; font-size: 22px;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 20px 0;">')
    .replace(/\n\n/g, '</p><p style="margin: 8px 0; line-height: 1.5;">')
    .replace(/\n/g, '<br>');
}

function wrapHtml(body) {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1a1a1a; font-size: 15px; line-height: 1.6;"><p style="margin: 8px 0; line-height: 1.5;">${body}</p></div>`;
}

// ── Main ─────────────────────────────────────────────────────────────────
const [, , subject, to, bodyPath] = process.argv;

if (!subject || !to || !bodyPath) {
  console.error('Usage: theories-send-email.js "Subject" "to@example.com" /path/to/body.md');
  process.exit(1);
}

const apiKey = process.env.AGENTMAIL_API_KEY || process.env.EMAIL_DEBATE_AGENTMAIL_API_KEY;
if (!apiKey) {
  console.error('No AgentMail API key found. Set EMAIL_DEBATE_AGENTMAIL_API_KEY in mac-app/.env.local');
  process.exit(1);
}

const domain = process.env.AGENTMAIL_DOMAIN || process.env.EMAIL_DEBATE_AGENTMAIL_DOMAIN || 'agentmail.to';
const fromInbox = process.env.THEORIES_FROM_INBOX || process.env.EMAIL_DEBATE_AGENTMAIL_INBOX_COUNCIL || `debateintake@${domain}`;
const fromName = process.env.EMAIL_DEBATE_FROM_NAME || 'Field Theory Council';

const textBody = fs.readFileSync(bodyPath, 'utf-8');
const htmlBody = wrapHtml(markdownToHtml(textBody));

// Use raw fetch — the agentmail SDK URL-encodes the @ in inbox IDs
const resp = await fetch(`https://api.agentmail.to/v0/inboxes/${fromInbox}/messages/send`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: [to],
    subject,
    from_name: fromName,
    text: textBody,
    html: htmlBody,
  }),
});

if (!resp.ok) {
  const body = await resp.text();
  console.error(`AgentMail ${resp.status}: ${body}`);
  process.exit(1);
}

console.log(`Theories digest emailed to ${to} from ${fromInbox}`);
