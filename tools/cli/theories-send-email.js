#!/usr/bin/env node
/**
 * theories-send-email.js — Standalone email sender for Theories digests.
 *
 * Reads the Field Theory email debate config from the mac app's stored
 * preferences and sends via AgentMail (primary) or SMTP (fallback).
 *
 * Usage:
 *   node theories-send-email.js "Subject" "to@example.com" /path/to/body.md
 *
 * Exit codes:
 *   0 — sent successfully
 *   1 — config not found or send failed
 */

const fs = require('fs');
const path = require('path');

// ── Config discovery ──────────────────────────────────────────────────────
const CONFIG_SEARCH_PATHS = [
  path.join(process.env.HOME, 'Library/Application Support/field-theory/email-debate-config.json'),
  path.join(process.env.HOME, 'Library/Application Support/Field Theory/email-debate-config.json'),
  path.join(process.env.HOME, '.config/field-theory/email-debate-config.json'),
];

function loadConfig() {
  for (const p of CONFIG_SEARCH_PATHS) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      // continue
    }
  }
  return null;
}

// ── Markdown → HTML conversion ───────────────────────────────────────────
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

// ── Send via AgentMail ───────────────────────────────────────────────────
async function sendViaAgentMail(config, subject, to, textBody, htmlBody) {
  const resp = await fetch('https://api.agentmail.to/v0/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.agentMailApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromAddress || `council@${config.agentMailDomain || 'agentmail.to'}`,
      from_name: 'Theories',
      to: [to],
      subject,
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`AgentMail ${resp.status}: ${body}`);
  }
}

// ── Send via SMTP ────────────────────────────────────────────────────────
async function sendViaSmtp(config, subject, to, textBody, htmlBody) {
  // nodemailer may not be globally installed — try require, fail gracefully
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('nodemailer not available. Install with: npm install -g nodemailer');
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  await transport.sendMail({
    from: `"Theories" <${config.fromAddress}>`,
    to,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const [, , subject, to, bodyPath] = process.argv;

  if (!subject || !to || !bodyPath) {
    console.error('Usage: theories-send-email.js "Subject" "to@example.com" /path/to/body.md');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.error('No email config found. Searched:');
    CONFIG_SEARCH_PATHS.forEach((p) => console.error(`  ${p}`));
    process.exit(1);
  }

  const textBody = fs.readFileSync(bodyPath, 'utf-8');
  const htmlBody = wrapHtml(markdownToHtml(textBody));

  // Try AgentMail first
  if (config.outboundTransport === 'agentmail' && config.agentMailApiKey) {
    try {
      await sendViaAgentMail(config, subject, to, textBody, htmlBody);
      console.log('Digest email sent via AgentMail.');
      return;
    } catch (err) {
      console.error(`AgentMail failed: ${err.message}`);
      console.log('Falling back to SMTP...');
    }
  }

  // SMTP fallback
  if (config.smtp && config.smtp.host) {
    try {
      await sendViaSmtp(config, subject, to, textBody, htmlBody);
      console.log('Digest email sent via SMTP.');
      return;
    } catch (err) {
      console.error(`SMTP failed: ${err.message}`);
    }
  }

  console.error('All email transports failed.');
  process.exit(1);
}

main();
