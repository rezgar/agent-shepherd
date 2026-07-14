import { useRef, useState } from 'react';

interface PastedImage {
  id: string;
  dataUrl: string;
}

let pasteIdSeq = 0;

/** Message input. Enter sends, Shift+Enter newlines, ↑ recalls the last message,
 *  pasted images attach and are read by the agent from a temp file. */
export function Composer({
  lastUserMessage,
  onSend,
  sending,
}: {
  lastUserMessage: string | null;
  onSend: (text: string, images?: string[]) => void;
  sending: boolean;
}) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<PastedImage[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = value.trim();
    if ((!t && !images.length) || sending) return;
    onSend(t, images.map((i) => i.dataUrl));
    setValue('');
    setImages([]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.items]
      .filter((it) => it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) {
      const reader = new FileReader();
      const id = String(pasteIdSeq++);
      reader.onload = () => {
        if (typeof reader.result === 'string') setImages((imgs) => [...imgs, { id, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (id: string) => setImages((imgs) => imgs.filter((i) => i.id !== id));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowUp' && value.trim() === '' && lastUserMessage) {
      e.preventDefault();
      setValue(lastUserMessage);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    // Shift+Enter falls through to the default → newline
  };

  return (
    <div className="composer">
      {images.length > 0 && (
        <div className="composer__images">
          {images.map((img) => (
            <div className="composer__thumb" key={img.id}>
              <img src={img.dataUrl} alt="pasted" />
              <button className="composer__thumb-remove" onClick={() => removeImage(img.id)} title="Remove">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer__row">
        <textarea
          ref={ref}
          className="composer__input"
          placeholder="Message this agent…   (Enter to send · Shift+Enter for newline · ↑ to edit last · paste an image to attach)"
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button
          className="composer__send composer__send--live"
          onClick={submit}
          disabled={sending || (!value.trim() && !images.length)}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
