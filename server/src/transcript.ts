import { readFile } from 'node:fs/promises';

export interface ChatTool {
  name: string;
  detail: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  /** Markdown body (may contain mermaid fences, image links, etc.). */
  text: string;
  tools: ChatTool[];
  /** Inline images as data URIs or URLs. */
  images: string[];
  ts: number;
}

export interface Transcript {
  type: 'transcript';
  sessionId: string;
  file: string;
  messages: ChatMsg[];
}

function textAndImages(content: unknown): { text: string; images: string[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };
  const texts: string[] = [];
  const images: string[] = [];
  for (const c of content as any[]) {
    if (!c) continue;
    if (c.type === 'text' && typeof c.text === 'string') texts.push(c.text);
    else if (c.type === 'image' && c.source) {
      if (c.source.type === 'base64' && c.source.data)
        images.push(`data:${c.source.media_type ?? 'image/png'};base64,${c.source.data}`);
      else if (c.source.type === 'url' && typeof c.source.url === 'string') images.push(c.source.url);
    }
  }
  return { text: texts.join('\n\n'), images };
}

// Matches the file-path notes sender.ts prepends for pasted images (there's no
// image-attachment flag for `claude -p`, so the real transcript only ever has
// a text pointer to the temp file — resolve it back to an actual image here).
const PASTE_NOTE_RE = /^\[Pasted image \d+ — read this file to view it: (.+?)\]\n?/gm;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

async function resolvePastedImages(text: string): Promise<{ text: string; images: string[] }> {
  const paths = [...text.matchAll(PASTE_NOTE_RE)].map((m) => m[1]);
  if (!paths.length) return { text, images: [] };
  const images: string[] = [];
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      images.push(`data:${MIME_BY_EXT[ext] ?? 'image/png'};base64,${buf.toString('base64')}`);
    } catch {
      // temp file gone or unreadable — skip it, don't break the rest of the message
    }
  }
  return { text: text.replace(PASTE_NOTE_RE, '').replace(/^\n+/, ''), images };
}

function toolDetail(name: string, input: any): string {
  const n = name.toLowerCase();
  const base = (p: unknown) =>
    typeof p === 'string' ? (p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '') : '';
  if (typeof input?.description === 'string' && input.description.trim()) return input.description.trim();
  if (/edit|write|notebook/.test(n) && input?.file_path) return base(input.file_path);
  if (n.includes('read') && input?.file_path) return base(input.file_path);
  if ((n.includes('bash') || n.includes('powershell')) && input?.command)
    return String(input.command).slice(0, 140);
  if ((n.includes('grep') || n.includes('glob')) && input?.pattern) return String(input.pattern).slice(0, 80);
  return '';
}

/** Parse a session transcript into renderable chat messages (thinking + tool
 *  results are dropped; the last `limit` turns are kept). */
export async function parseTranscript(file: string, sessionId: string, limit = 80): Promise<Transcript> {
  const msgs: ChatMsg[] = [];
  let i = 0;

  // Read a point-in-time snapshot rather than streaming to EOF — the transcript
  // of a live session is appended to continuously, and a following stream would
  // never resolve while the agent is mid-response.
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { type: 'transcript', sessionId, file, messages: [] };
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : 0;

    if (o.type === 'user') {
      // System-injected content rides in as "user" events but nothing the
      // actual person typed — never render it as if they said it. Two
      // distinct markers seen in the wild: isMeta (skill bodies, other
      // injected context) and origin.kind (background task notifications).
      if (o.isMeta === true) continue;
      if (o.origin?.kind === 'task-notification') continue;
      const content = o.message?.content;
      // Tool results arrive as "user" events — don't render them as user turns.
      if (Array.isArray(content) && content.some((c: any) => c?.type === 'tool_result')) continue;
      const { text: rawText, images: inlineImages } = textAndImages(content);
      if (!rawText.trim() && !inlineImages.length) continue;
      const { text, images: pastedImages } = await resolvePastedImages(rawText);
      if (!text.trim() && !inlineImages.length && !pastedImages.length) continue;
      msgs.push({ id: o.uuid ?? `u${i++}`, role: 'user', text, tools: [], images: [...inlineImages, ...pastedImages], ts });
    } else if (o.type === 'assistant') {
      const content = o.message?.content;
      const { text, images } = textAndImages(content);
      const tools: ChatTool[] = Array.isArray(content)
        ? content
            .filter((c: any) => c?.type === 'tool_use')
            .map((c: any) => ({ name: String(c.name ?? ''), detail: toolDetail(String(c.name ?? ''), c.input ?? {}) }))
        : [];
      if (!text.trim() && !tools.length && !images.length) continue;
      msgs.push({ id: o.uuid ?? `a${i++}`, role: 'assistant', text, tools, images, ts });
    }
  }

  // Return the full parsed list; the WebSocket layer decides the window to send.
  return { type: 'transcript', sessionId, file, messages: msgs };
}
