// @xterm/headless's CJS bundle assigns its exports via a runtime loop, not
// static `exports.Terminal = ...`, so the default import (the whole
// module.exports object) is the only reliable way to reach the constructor —
// same interop dance as usage.ts.
import xtermHeadless from '@xterm/headless';
import type { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

const { Terminal: HeadlessTerminal } = xtermHeadless;

/** Scrollback rows the server-side mirror retains — and the ceiling on how much
 *  history a fresh attach reconstructs. Bounded so many idle sessions don't add
 *  up (each session keeps one of these alive for its whole life); a full screen
 *  plus generous scrollback, comparable to the old 256 KB raw-byte ring buffer
 *  this replaces, at a fraction of the per-session cost when trimmed here. */
const SCREEN_SCROLLBACK = 1000;

/** An authoritative, server-side mirror of one session's terminal screen.
 *
 *  It is a real (headless) xterm.js instance fed the exact same raw PTY bytes
 *  the browser terminal receives, so it always holds the true current grid —
 *  cursor position, colors, the CLI's bottom-anchored input box, everything.
 *
 *  Why this exists: attaching a client used to replay a ring buffer of raw PTY
 *  bytes that had been wrapped and cursor-positioned for whatever width the PTY
 *  happened to be at when they were captured. Fed into a fresh xterm at a
 *  DIFFERENT width, those bytes reflow into garbage — fused words, misaligned
 *  lines (issues #31/#45, previously papered over with a racy ±1-column repaint
 *  nudge). Serializing THIS mirror instead is garble-proof by construction:
 *  resize it to exactly the attaching client's grid first (xterm reflows its
 *  OWN buffer cleanly, which raw bytes never do), then serialize. The snapshot
 *  and the client are the same size, so there is nothing to reflow on arrival. */
export class SessionScreen {
  private readonly term: Terminal;
  private readonly serializer: SerializeAddon;
  private disposed = false;

  constructor(cols: number, rows: number) {
    this.term = new HeadlessTerminal({
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      scrollback: SCREEN_SCROLLBACK,
      // SerializeAddon reads the buffer via the proposed API surface; usage.ts
      // enables the same flag for the same underlying reason.
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);
  }

  /** Feed raw PTY output — the identical stream sent live to attached clients. */
  write(chunk: string): void {
    if (this.disposed) return;
    this.term.write(chunk);
  }

  /** Resize the mirror to match a client's grid. Degenerate sizes (container
   *  not laid out yet) are ignored rather than throwing. */
  resize(cols: number, rows: number): void {
    if (this.disposed || cols < 1 || rows < 1) return;
    this.term.resize(cols, rows);
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  /** Serialize the current screen (+ scrollback) into escape sequences that
   *  reproduce it exactly when written into a same-size xterm. Flushes the
   *  parser first — `write()` parses asynchronously, so a snapshot taken right
   *  after a burst would otherwise miss the tail. */
  async snapshot(): Promise<string> {
    if (this.disposed) return '';
    await this.flush();
    if (this.disposed) return ''; // could be disposed while flushing (eviction race)
    return this.serializer.serialize({ scrollback: SCREEN_SCROLLBACK });
  }

  /** Current screen + scrollback as plain text — used by tests to assert a
   *  snapshot reproduces the live grid. Flushes pending writes first. */
  async text(): Promise<string> {
    if (this.disposed) return '';
    await this.flush();
    if (this.disposed) return '';
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }

  dispose(): void {
    // Idempotent: a PTY's onExit can fire more than once, and disposing xterm
    // twice throws.
    if (this.disposed) return;
    this.disposed = true;
    this.term.dispose();
  }

  /** Resolve once every queued `write()` has been parsed into the grid. xterm's
   *  write callback fires when the write buffer drains up to and including this
   *  (empty) write. */
  private flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise<void>((resolve) => this.term.write('', resolve));
  }
}
