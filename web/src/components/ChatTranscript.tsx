import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMsg } from '../types';
import { Mermaid } from './Mermaid';
import { QuestionCard } from './QuestionCard';

const mdComponents = {
  code({ className, children, ...props }: any) {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    if (lang === 'mermaid') return <Mermaid chart={String(children).replace(/\n$/, '')} />;
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ children, ...props }: any) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

function Message({
  msg,
  interactive,
  onAnswer,
}: {
  msg: ChatMsg;
  interactive: boolean;
  onAnswer: (text: string) => void;
}) {
  const questionTools = msg.tools.filter((t) => t.questions?.length);
  const plainTools = msg.tools.filter((t) => !t.questions?.length);
  return (
    <div className={`msg msg--${msg.role}${msg.pending ? ' msg--pending' : ''}`}>
      <div className="msg__role">
        {msg.role === 'user' ? 'You' : 'Agent'}
        {msg.pending && <span className="msg__pending-tag">sending…</span>}
      </div>
      {msg.text && (
        <div className="md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {msg.text}
          </ReactMarkdown>
        </div>
      )}
      {msg.images.map((src, i) => (
        <img key={i} className="msg__img" src={src} alt="" />
      ))}
      {questionTools.map((t, i) => (
        <QuestionCard key={`q${i}`} tool={t} interactive={interactive} onAnswer={onAnswer} />
      ))}
      {plainTools.length > 0 && (
        <div className="msg__tools">
          {plainTools.map((t, i) => (
            <span key={i} className="toolchip" title={t.detail}>
              {t.name}
              {t.detail ? `: ${t.detail}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatTranscript({
  messages,
  hasMore,
  onLoadMore,
  onAnswer,
  answerable = true,
}: {
  messages: ChatMsg[] | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onAnswer: (text: string) => void;
  /** False for read-only views (e.g. the subagent modal) — no question is answerable. */
  answerable?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pinBottom = useRef(true);
  const olderPrevHeight = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (olderPrevHeight.current != null) {
      // older messages were prepended — keep the viewport where it was
      el.scrollTop += el.scrollHeight - olderPrevHeight.current;
      olderPrevHeight.current = null;
    } else if (pinBottom.current) {
      endRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && olderPrevHeight.current == null) {
      olderPrevHeight.current = el.scrollHeight;
      onLoadMore();
    }
  };

  if (messages == null) return <div className="chat chat--empty">Loading conversation…</div>;
  if (!messages.length) return <div className="chat chat--empty">No messages yet.</div>;

  const lastIdx = messages.length - 1;
  return (
    <div className="chat" ref={scrollRef} onScroll={onScroll}>
      {hasMore && <div className="chat__more">↑ scroll for earlier messages</div>}
      {messages.map((m, i) => (
        // Only the latest message's question is answerable — that's the one the
        // agent is actually waiting on; older ones render read-only.
        <Message key={m.id} msg={m} interactive={answerable && i === lastIdx} onAnswer={onAnswer} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
