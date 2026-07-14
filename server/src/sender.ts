import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASTE_DIR = path.join(os.tmpdir(), 'agent-shepherd-pastes');

/** Decode a pasted `data:image/png;base64,...` URI to a temp file and return
 *  its absolute path — the CLI's `-p` has no image-attachment flag, but the
 *  agent's own Read tool can view an image given its path, so we hand it one. */
function saveImage(sessionId: string, dataUrl: string, index: number): string | null {
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const dir = path.join(PASTE_DIR, sessionId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${Date.now()}-${index}.${m[1]}`);
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

/**
 * Reply into an existing session by resuming it. `claude --resume <id> -p <text>`
 * continues the same session and appends to the transcript the daemon already
 * watches — so the reply renders through the normal transcript-update path; we
 * don't parse the child's stdout for rendering, only track completion/errors.
 *
 * cross-spawn is used so `claude` resolves through its Windows `.cmd` shim and
 * the message text is passed as a real argv entry (no shell quoting).
 */
export function sendToSession(
  sessionId: string,
  cwd: string,
  text: string,
  images: string[] | undefined,
  onDone: () => void,
  onError: (msg: string) => void,
): ChildProcess {
  const paths = (images ?? []).map((img, i) => saveImage(sessionId, img, i)).filter((p): p is string => !!p);
  const notes = paths.map((p, i) => `[Pasted image ${i + 1} — read this file to view it: ${p}]`).join('\n');
  const fullText = notes ? `${notes}\n\n${text}`.trim() : text;

  const child = spawn(
    'claude',
    ['--resume', sessionId, '-p', fullText, '--output-format', 'stream-json', '--verbose'],
    { cwd, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  child.stderr?.on('data', (d) => {
    err += d.toString();
  });
  child.on('error', (e) => onError(e.message));
  child.on('exit', (code) => (code === 0 ? onDone() : onError(err.trim() || `claude exited with ${code}`)));
  return child;
}
