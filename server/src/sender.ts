import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';

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
  onDone: () => void,
  onError: (msg: string) => void,
): ChildProcess {
  const child = spawn(
    'claude',
    ['--resume', sessionId, '-p', text, '--output-format', 'stream-json', '--verbose'],
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
