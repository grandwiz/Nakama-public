import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "./types";

export function MessageTimestamp({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const timestampId = useId();
  const date = new Date(message.createdAt);
  const valid = Number.isFinite(date.getTime());
  return (
    <>
      <button
        type="button"
        className="message-text message-text-button"
        title={expanded ? "Hide message timestamp" : "Show message timestamp"}
        aria-expanded={expanded}
        aria-controls={timestampId}
        onClick={() => setExpanded((value) => !value)}
      >
        {message.content}
      </button>
      {expanded && (
        <time
          className="message-exact-time"
          id={timestampId}
          dateTime={valid ? date.toISOString() : undefined}
        >
          {valid
            ? date.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "long",
              })
            : "Time not recorded"}
        </time>
      )}
    </>
  );
}

/** New replies preserve the reader's position; an explicit submission returns to its own message. */
export function useChatTimeline(messages: Message[], conversation: string) {
  const viewport = useRef<HTMLDivElement>(null);
  const previous = useRef<
    { conversation: string; ids: Set<string> } | undefined
  >(undefined);
  const following = useRef(true);
  const pending = useRef<{ text: string; known: Set<string> } | undefined>(
    undefined,
  );
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(0);
  const ids = messages.map((message) => message.id).join("|");
  function latest() {
    const node = viewport.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    following.current = true;
    setAway(false);
    setUnread(0);
  }
  function onScroll() {
    const node = viewport.current;
    if (!node) return;
    const near = node.scrollHeight - node.scrollTop - node.clientHeight <= 48;
    following.current = near;
    setAway(!near);
    if (near) setUnread(0);
  }
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const current = new Set(messages.map((message) => message.id));
    const changedConversation = previous.current?.conversation !== conversation;
    const added =
      previous.current && !changedConversation
        ? messages.filter((message) => !previous.current!.ids.has(message.id))
        : [];
    previous.current = { conversation, ids: current };
    if (changedConversation || current.size === 0) {
      pending.current = undefined;
      latest();
      return;
    }
    const sent =
      pending.current &&
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            !pending.current!.known.has(message.id) &&
            message.content.trim() === pending.current!.text,
        );
    if (sent) {
      const target = node.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(sent.id)}"]`,
      );
      if (target)
        node.scrollTo({
          top:
            node.scrollTop +
            target.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            16,
          behavior: "instant",
        });
      pending.current = undefined;
      setUnread(0);
      onScroll();
    } else if (following.current) latest();
    else if (added.length) setUnread((count) => count + added.length);
  }, [ids, conversation]);
  return {
    viewport,
    away,
    unread,
    latest,
    onScroll,
    submitted: (text: string) => {
      pending.current = {
        text: text.trim(),
        known: new Set(messages.map((message) => message.id)),
      };
    },
    failed: () => {
      pending.current = undefined;
    },
  };
}
