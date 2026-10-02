import { useEffect, useState } from "react";
import { Heart, Pencil, Trash2 } from "lucide-react";
import { Button, Toggle } from "./components";
import { useNakama } from "./context";

export interface CompanionMemoryEntry {
  id: string;
  category: "note" | "preference" | "trait" | "routine" | "personality";
  text: string;
  source: "user_request" | "user_setting";
  createdAt: string;
  updatedAt: string;
}
export interface CompanionMemoryState {
  version: number;
  entries: CompanionMemoryEntry[];
}

export function CompanionMemorySettings({
  showMemoryControl = false,
}: {
  showMemoryControl?: boolean;
}) {
  const { state, perform, setNavigationGuard } = useNakama();
  // These optional fields also let an older host open Settings safely.
  const companion = (
    state as typeof state & {
      companionMemory?: CompanionMemoryState;
    }
  ).companionMemory;
  const config = state.config as typeof state.config & {
    companionLearningEnabled?: boolean;
  };
  const entries = companion?.entries || [];
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [category, setCategory] =
    useState<CompanionMemoryEntry["category"]>("preference");
  const [busy, setBusy] = useState(false);
  const savedEntry = entries.find((entry) => entry.id === editing);
  const hasDraft = editing
    ? draft !== savedEntry?.text || category !== savedEntry?.category
    : Boolean(draft.trim());
  useEffect(() => {
    // Settings owns a separate AI-role guard; only the standalone editor owns this one.
    if (!showMemoryControl) return;
    setNavigationGuard(
      hasDraft
        ? () => window.confirm("Discard your unsaved Core Memory note?")
        : null,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasDraft) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [showMemoryControl, hasDraft, setNavigationGuard]);

  function reset() {
    setEditing(null);
    setDraft("");
    setCategory("preference");
  }
  async function save() {
    setBusy(true);
    try {
      const result = await perform(
        editing ? "PATCH" : "POST",
        `/api/companion-memory${editing ? `/${editing}` : ""}`,
        { text: draft.trim(), category },
        "Companion note saved.",
      );
      if (result) reset();
    } finally {
      setBusy(false);
    }
  }
  async function forget(id?: string) {
    setBusy(true);
    try {
      const result = await perform(
        "DELETE",
        `/api/companion-memory${id ? `/${id}` : ""}`,
        undefined,
        "Saved notes forgotten. Conversation history is unchanged.",
      );
      if (result && (!id || editing === id)) reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-label">
        <Heart size={22} />
        <h3>Your Nakama companion</h3>
        <p>Core Memory: a familiar personality, shaped by things you share.</p>
      </div>
      <div className="settings-section-body">
        <p className="small-copy">
          You’re always talking to Nakama, using your configured conversation
          model (ChatGPT Astra by default). Core Memory stores your preferences,
          self-described traits and the personality you want Nakama to have.
          These editable local notes personalise future replies without
          retraining the model.
        </p>
        {showMemoryControl && (
          <Toggle
            checked={state.config.memoryEnabled !== false}
            label="Use memory in conversation"
            description="Use saved conversation context and Core Memory in replies. Turning this off pauses learning and reuse; your notes remain editable."
            onChange={(memoryEnabled) =>
              void perform(
                "PATCH",
                "/api/settings",
                { memoryEnabled },
                "Conversation memory preference saved.",
              )
            }
          />
        )}
        <Toggle
          checked={config.companionLearningEnabled !== false}
          label="Remember preferences I share in conversation"
          description={
            "In everyday chat, save a short “Remember that …”, “My preference: …”, “My trait: …”, “My routine: …”, “Nakama personality: …”, “I prefer …”, “I usually …” or “I tend to …” statement. No personality traits are guessed."
          }
          onChange={(value) =>
            void perform(
              "PATCH",
              "/api/settings",
              { companionLearningEnabled: value },
              "Companion learning preference saved.",
            )
          }
        />
        <p className="small-copy">
          {state.config.memoryEnabled === false
            ? "Conversation memory is off, so learning and reuse of these notes are paused. You can still edit or forget them here."
            : "The latest 12 notes may be shared with your selected AI in conversation. Turning learning off stops new automatic notes; turning conversation memory off pauses reuse as well."}
        </p>
        <div className="settings-divider" />
        <h4>What Nakama remembers ({entries.length}/50)</h4>
        <p className="small-copy">
          Review or correct your own notes below. Forget removes saved notes;
          conversation history and information already sent to a provider
          remain. Keep passwords and credentials out of these notes.
        </p>
        {entries.length === 0 && (
          <p className="small-copy">No saved companion notes yet.</p>
        )}
        {entries.map((entry) => (
          <article
            key={entry.id}
            className="callout"
            style={{ marginBottom: 12 }}
          >
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {entry.text}
            </p>
            <p className="small-copy">
              {entry.category} ·{" "}
              {entry.source === "user_request"
                ? "You said this in chat"
                : "You added or edited this"}
            </p>
            <div className="button-row">
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(entry.id);
                  setDraft(entry.text);
                  setCategory(entry.category);
                }}
                aria-label={`Edit note: ${entry.text}`}
              >
                <Pencil size={14} /> Edit
              </Button>
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() => void forget(entry.id)}
                aria-label={`Forget note: ${entry.text}`}
              >
                <Trash2 size={14} /> Forget
              </Button>
            </div>
          </article>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h4>{editing ? "Edit your note" : "Add a note"}</h4>
          <label className="field">
            <span>Category</span>
            <select
              value={category}
              disabled={busy}
              onChange={(event) =>
                setCategory(
                  event.target.value as CompanionMemoryEntry["category"],
                )
              }
            >
              <option value="preference">Preference</option>
              <option value="trait">Trait I describe myself</option>
              <option value="routine">
                Routine note (does not set an alarm)
              </option>
              <option value="personality">Nakama’s personality</option>
              <option value="note">Note</option>
            </select>
          </label>
          <label className="field">
            <span>
              {editing ? "Saved note" : "What should Nakama remember?"}
            </span>
            <input
              value={draft}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="I prefer short, practical answers."
            />
          </label>
          <div className="button-row">
            <Button
              type="submit"
              busy={busy}
              disabled={!draft.trim() || (!editing && entries.length >= 50)}
            >
              {editing ? "Save changes" : "Save note"}
            </Button>
            {editing && (
              <Button
                type="button"
                kind="ghost"
                disabled={busy}
                onClick={reset}
              >
                Cancel edit
              </Button>
            )}
            {entries.length > 0 && (
              <Button
                type="button"
                kind="danger"
                disabled={busy}
                onClick={() => void forget()}
              >
                Forget all notes
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
