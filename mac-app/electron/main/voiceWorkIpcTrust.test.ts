import { describe, expect, it } from 'vitest';
import { assertVoiceWorkSender, isVoiceWorkWindowTrusted } from './voiceWorkIpcTrust';

const entry = { appPath: '/Applications/Field Theory.app/Contents/Resources/app.asar' };
const trusted = 'file:///Applications/Field%20Theory.app/Contents/Resources/app.asar/dist/index.html';

function fixture(url = trusted) {
  const frame = { url };
  const contents = { mainFrame: frame, getURL: () => url, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  return { window, contents, frame, event: { sender: contents, senderFrame: frame } };
}

describe('Voice work IPC trust', () => {
  it('accepts only the current main-window top frame at the packaged Settings entry', () => {
    const current = fixture(`${trusted}?view=settings#voice-requests`);
    expect(isVoiceWorkWindowTrusted(current.window, entry)).toBe(true);
    expect(() => assertVoiceWorkSender(current.event, current.window, entry)).not.toThrow();
  });

  it('rejects a different window even when it displays the identical app entry', () => {
    const current = fixture();
    const unrelated = fixture();
    expect(() => assertVoiceWorkSender(unrelated.event, current.window, entry)).toThrow(/Field Theory Settings/);
  });

  it('rejects nested frames, including a frame with the identical entry URL', () => {
    const current = fixture();
    for (const senderFrame of [null, { url: trusted }, { url: 'https://example.com/' }]) {
      expect(() => assertVoiceWorkSender({ sender: current.contents, senderFrame }, current.window, entry))
        .toThrow(/Field Theory Settings/);
    }
  });

  it.each([
    'https://example.com/',
    'file:///tmp/index.html',
    trusted.replace('/dist/index.html', '/dist/clipboard-history.html'),
    `${trusted}.backup`,
    `file://remote-host${new URL(trusted).pathname}`,
    'about:blank',
    'data:text/html,hello',
    'not a URL',
  ])('rejects navigation of the main window to %s for invocation and state publication', (url) => {
    const current = fixture(url);
    expect(isVoiceWorkWindowTrusted(current.window, entry)).toBe(false);
    expect(() => assertVoiceWorkSender(current.event, current.window, entry)).toThrow(/Field Theory Settings/);
  });

  it('rejects disagreement between the current document and frame URL', () => {
    const current = fixture();
    current.frame.url = 'https://example.com/';
    expect(isVoiceWorkWindowTrusted(current.window, entry)).toBe(false);
    expect(() => assertVoiceWorkSender(current.event, current.window, entry)).toThrow(/Field Theory Settings/);
  });

  it('fails closed after renderer navigation or replacement during an async invocation', () => {
    const current = fixture();
    assertVoiceWorkSender(current.event, current.window, entry);
    current.contents.mainFrame = { url: trusted };
    expect(() => assertVoiceWorkSender(current.event, current.window, entry)).toThrow(/Field Theory Settings/);
    current.contents.mainFrame.url = 'https://example.com/';
    expect(isVoiceWorkWindowTrusted(current.window, entry)).toBe(false);
  });

  it('rejects missing, destroyed, or inaccessible renderers', () => {
    expect(isVoiceWorkWindowTrusted(null, entry)).toBe(false);
    const destroyedWindow = fixture();
    destroyedWindow.window.isDestroyed = () => true;
    expect(isVoiceWorkWindowTrusted(destroyedWindow.window, entry)).toBe(false);
    const destroyedContents = fixture();
    destroyedContents.contents.isDestroyed = () => true;
    expect(isVoiceWorkWindowTrusted(destroyedContents.window, entry)).toBe(false);
    const inaccessible = fixture();
    inaccessible.contents.getURL = () => { throw new Error('Renderer destroyed'); };
    expect(isVoiceWorkWindowTrusted(inaccessible.window, entry)).toBe(false);
  });

  it('accepts the exact configured development entry while denying sibling pages and origins', () => {
    const development = { ...entry, startUrl: 'http://localhost:5173/settings?mode=voice' };
    const current = fixture('http://localhost:5173/settings?mode=other#voice');
    expect(isVoiceWorkWindowTrusted(current.window, development)).toBe(true);
    expect(() => assertVoiceWorkSender(current.event, current.window, development)).not.toThrow();
    for (const url of ['http://localhost:5173/library', 'http://localhost:5174/settings',
      'https://localhost:5173/settings', 'http://localhost:5173.evil.example/settings', trusted]) {
      expect(isVoiceWorkWindowTrusted(fixture(url).window, development)).toBe(false);
    }
  });

  it('rejects unsupported or credential-bearing development entries and accepts an empty override as production', () => {
    for (const startUrl of ['data:text/html,hello', 'javascript:alert(1)', 'http://user:password@localhost:5173/', 'bad']) {
      expect(isVoiceWorkWindowTrusted(fixture(startUrl).window, { ...entry, startUrl })).toBe(false);
    }
    expect(isVoiceWorkWindowTrusted(fixture().window, { ...entry, startUrl: '' })).toBe(true);
  });
});
