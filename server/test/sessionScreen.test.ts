import { describe, it, expect } from 'vitest';
import xtermHeadless from '@xterm/headless';
import { SessionScreen } from '../src/sessionScreen.js';

// interop: @xterm/headless's CJS bundle exposes Terminal off the default import
// (see server/src/usage.ts for the same pattern).
const { Terminal } = xtermHeadless as unknown as {
  Terminal: typeof import('@xterm/headless').Terminal;
};

/** Render a headless terminal's scrollback + viewport to plain text, trimming
 *  trailing blank lines so two terminals of the same content compare equal even
 *  if one has extra empty rows below. */
function renderText(term: import('@xterm/headless').Terminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

/** Write a serialized snapshot into a fresh headless terminal at `cols`x`rows`
 *  and return what it renders — this is exactly what the browser client does
 *  with the snapshot the server sends on attach. */
async function renderSnapshotAt(snapshot: string, cols: number, rows: number): Promise<string> {
  const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
  await new Promise<void>((resolve) => term.write(snapshot, resolve));
  const text = renderText(term);
  term.dispose();
  return text;
}

describe('SessionScreen', () => {
  /** @cod CR-1 Attaching shows a legible screen at the client's own window size */
  it('produces a snapshot that reproduces the screen exactly when re-rendered at the client width', async () => {
    // Session PTY produced output at a wide width; the attaching client is narrow.
    const screen = new SessionScreen(80, 24);
    screen.write('alpha beta gamma\r\n');
    screen.write('\x1b[32mThe quick brown fox jumps over the lazy dog repeatedly\x1b[0m\r\n');
    screen.write('tail line');

    // Client attaches at 30 cols — server resizes the screen to match, then snapshots.
    screen.resize(30, 24);
    const snapshot = await screen.snapshot();

    const fromSnapshot = await renderSnapshotAt(snapshot, 30, 24);
    const live = await screen.text();

    // The client's reconstruction must match the live screen character-for-character
    // — no fused words, no misaligned lines. This is the anti-garble guarantee.
    expect(fromSnapshot).toBe(live);
  });

  /** @cod CR-1 Attaching shows a legible screen at the client's own window size */
  it('reflows to a narrower client width exactly as the live screen does', async () => {
    const screen = new SessionScreen(60, 10);
    // Longer than the narrow client width — wrapping is what could garble.
    screen.write('one two three four five six seven eight nine ten eleven twelve');
    screen.resize(20, 10);
    const snapshot = await screen.snapshot();

    // The reconstruction must equal the live screen character-for-character —
    // whatever the 20-col wrap does (a word may legitimately split at the
    // boundary), the client sees precisely what the session has, not garble.
    expect(await renderSnapshotAt(snapshot, 20, 10)).toBe(await screen.text());
  });

  /** @cod CR-1 Attaching shows a legible screen at the client's own window size */
  it('preserves gaps drawn with cursor-positioning (no fused words like "Currentsession")', async () => {
    const screen = new SessionScreen(40, 5);
    // "left", then a cursor-forward of 10 columns, then "right". The gap is NOT
    // literal spaces — it's a cursor move, the exact construct that fuses words
    // when ANSI is naively stripped (see usage.ts). A real emulator keeps it.
    screen.write('left\x1b[10Cright');
    const snapshot = await screen.snapshot();

    const fromSnapshot = await renderSnapshotAt(snapshot, 40, 5);
    expect(fromSnapshot).toBe(await screen.text());
    expect(fromSnapshot).toMatch(/left\s+right/);
    expect(fromSnapshot).not.toContain('leftright');
  });

  /** @cod CR-1 Attaching shows a legible screen at the client's own window size */
  it('preserves scrollback beyond a single screen in the snapshot', async () => {
    const screen = new SessionScreen(40, 5); // only 5 visible rows
    for (let i = 0; i < 20; i++) screen.write(`line ${i}\r\n`);
    const snapshot = await screen.snapshot();

    const fromSnapshot = await renderSnapshotAt(snapshot, 40, 5);
    // Content that scrolled off the 5-row viewport is still reachable in the snapshot.
    expect(fromSnapshot).toContain('line 0');
    expect(fromSnapshot).toContain('line 19');
  });

  /** @cod CR-1 Attaching shows a legible screen at the client's own window size */
  it('reflects the most recent writes (pending parse is flushed before serialize)', async () => {
    const screen = new SessionScreen(40, 10);
    screen.write('before');
    // No manual delay — snapshot() must flush the parser itself.
    const snapshot = await screen.snapshot();
    const fromSnapshot = await renderSnapshotAt(snapshot, 40, 10);
    expect(fromSnapshot).toContain('before');
  });

  it('is inert after dispose instead of throwing (eviction race safety)', async () => {
    const screen = new SessionScreen(40, 10);
    screen.write('hello');
    screen.dispose();
    // A late PTY chunk / attach after eviction must not blow up.
    expect(() => screen.write('late chunk')).not.toThrow();
    expect(() => screen.resize(80, 24)).not.toThrow();
    expect(() => screen.dispose()).not.toThrow(); // idempotent
    expect(await screen.snapshot()).toBe('');
  });

  it('resize reports the new dimensions', () => {
    const screen = new SessionScreen(80, 24);
    screen.resize(100, 40);
    expect(screen.cols).toBe(100);
    expect(screen.rows).toBe(40);
    // Degenerate sizes are ignored rather than throwing.
    screen.resize(0, 0);
    expect(screen.cols).toBe(100);
    expect(screen.rows).toBe(40);
  });
});
