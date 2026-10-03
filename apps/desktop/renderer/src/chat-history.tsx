import { useEffect, useRef, useState } from "react";
import { Archive, Check } from "lucide-react";
import { api } from "./bridge";
import { Button, Modal } from "./components";
import { useNakama } from "./context";
import { MessageTimestamp } from "./chat-timeline";
import type { ChatRecord, Message } from "./types";

type HistoryPage = { chats: ChatRecord[]; nextCursor?: string | null };
type Transcript = { chat: ChatRecord; messages: Message[] };
const stamp = (value: string) => new Date(value).toLocaleString();

export function ChatHistoryControls({ projectId }: { projectId: string }) {
  const { state, perform } = useNakama();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<HistoryPage>({ chats: [] });
  const [detail, setDetail] = useState<Transcript>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const generation = useRef(0);
  const transcriptGeneration = useRef(0);
  const current = state.chatHistory?.chats.find(
    (chat) =>
      chat.status === "active" &&
      (chat.projectId || "") === projectId &&
      chat.deliveryDeviceId === "desktop",
  );
  useEffect(() => {
    const ticket = ++generation.current;
    ++transcriptGeneration.current;
    setDetail(undefined);
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = await api<HistoryPage>(
          "GET",
          `/api/chats?q=${encodeURIComponent(query.trim())}`,
        );
        if (generation.current === ticket) setPage(result);
      } catch (failure) {
        if (generation.current === ticket)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load chat history.",
          );
      } finally {
        if (generation.current === ticket) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      ++generation.current;
      ++transcriptGeneration.current;
    };
  }, [open, query]);
  async function inspect(id: string) {
    const ticket = ++transcriptGeneration.current;
    setDetail(undefined);
    setError("");
    try {
      const result = await api<Transcript>(
        "GET",
        `/api/chats/${encodeURIComponent(id)}`,
      );
      if (ticket === transcriptGeneration.current) setDetail(result);
    } catch (failure) {
      if (ticket === transcriptGeneration.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not load this conversation.",
        );
    }
  }
  async function more() {
    if (!page.nextCursor || loading) return;
    const ticket = generation.current;
    setLoading(true);
    try {
      const result = await api<HistoryPage>(
        "GET",
        `/api/chats?q=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      if (ticket === generation.current)
        setPage((previous) => ({
          ...result,
          chats: [...previous.chats, ...result.chats],
        }));
    } catch (failure) {
      if (ticket === generation.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not load more conversations.",
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  async function complete(chat: ChatRecord) {
    if (completing) return;
    setCompleting(true);
    const result = await perform<{ chat: ChatRecord }>(
      "POST",
      `/api/chats/${encodeURIComponent(chat.id)}/complete`,
      { revision: chat.revision },
    );
    setCompleting(false);
    if (result) {
      setPage((previous) => ({
        ...previous,
        chats: previous.chats.map((item) =>
          item.id === chat.id ? result.chat : item,
        ),
      }));
      setDetail((previous) =>
        previous?.chat.id === chat.id
          ? { ...previous, chat: result.chat }
          : previous,
      );
    }
  }
  return (
    <div className="chat-history-controls">
      {current && (
        <Button
          kind="ghost"
          disabled={!current.canComplete || completing}
          onClick={() => void complete(current)}
          title={
            current.canComplete
              ? "Save this conversation in history"
              : "Finish active work or answer its questions first"
          }
        >
          <Check size={14} /> Complete chat
        </Button>
      )}
      <Button kind="ghost" onClick={() => setOpen(true)}>
        <Archive size={14} /> Chat history
      </Button>
      {open && (
        <Modal
          title="Chat history"
          description="Completed chats and six-hour conversations stay searchable on your PC. Summaries are local extracts."
          onClose={() => setOpen(false)}
          wide
        >
          <label className="field">
            Search saved conversations
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find words from a message or summary"
            />
          </label>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="chat-archive-layout">
            <div className="chat-archive-list" aria-label="Saved conversations">
              {page.chats.map((chat) => (
                <button
                  type="button"
                  key={chat.id}
                  aria-pressed={detail?.chat.id === chat.id}
                  onClick={() => void inspect(chat.id)}
                >
                  <strong>{stamp(chat.startedAt)}</strong>
                  <span>
                    {chat.status} · {chat.messageCount} messages
                  </span>
                  <p>{chat.summary || "Open conversation"}</p>
                </button>
              ))}
              {!loading && !page.chats.length && (
                <p>No saved conversations match this search.</p>
              )}
              {loading && <p role="status">Loading conversations…</p>}
              {page.nextCursor && (
                <Button
                  kind="secondary"
                  disabled={loading}
                  onClick={() => void more()}
                >
                  Load older chats
                </Button>
              )}
            </div>
            <div
              className="chat-archive-detail"
              aria-label="Saved conversation messages"
            >
              {!detail && (
                <p>Select a conversation to read its original messages.</p>
              )}
              {detail && (
                <>
                  <p>{detail.chat.summary}</p>
                  {detail.chat.canComplete && (
                    <Button
                      kind="secondary"
                      disabled={completing}
                      onClick={() => void complete(detail.chat)}
                    >
                      Complete this chat
                    </Button>
                  )}
                  {detail.messages.map((message) => (
                    <article
                      className="message-content archive-message"
                      key={message.id}
                    >
                      <strong>
                        {message.role === "user" ? "You" : "Nakama"}
                      </strong>
                      <MessageTimestamp message={message} />
                    </article>
                  ))}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
