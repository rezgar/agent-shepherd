import { useRef, useState } from 'react';

/** Message input. Enter sends, Shift+Enter newlines, ↑ recalls the last message. */
export function Composer({
  lastUserMessage,
  onSend,
  sending,
}: {
  lastUserMessage: string | null;
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = value.trim();
    if (!t || sending) return;
    onSend(t);
    setValue('');
  };

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
      <textarea
        ref={ref}
        className="composer__input"
        placeholder="Message this agent…   (Enter to send · Shift+Enter for newline · ↑ to edit last)"
        value={value}
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        className="composer__send composer__send--live"
        onClick={submit}
        disabled={sending || !value.trim()}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
