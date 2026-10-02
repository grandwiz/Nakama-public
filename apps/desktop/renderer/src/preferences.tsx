import { Brain, Coins, Monitor } from "lucide-react";
import { TextLink, Toggle } from "./components";
import { useNakama } from "./context";
import { CompanionMemorySettings } from "./companion-memory";

export function MemorySpendSettings() {
  const { state, perform, navigate } = useNakama();
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-label">
          <Monitor size={22} />
          <h3>Keep Nakama close</h3>
          <p>Control when your Windows companion stays available.</p>
        </div>
        <div className="settings-section-body">
          <Toggle
            checked={state.config.closeToTray !== false}
            label="Keep running when I close the window"
            description="Close to the Windows notification area so paired devices can still reach your host. Use Quit from the tray menu to stop Nakama."
            onChange={(value) =>
              void perform(
                "PATCH",
                "/api/settings",
                { closeToTray: value },
                "Close-to-tray preference saved.",
              )
            }
          />
          <Toggle
            checked={state.config.startWithWindows === true}
            label="Start with Windows"
            description="Launch Nakama when you sign in. This takes effect only in the installed Windows app; source development runs ignore it."
            onChange={(value) =>
              void perform(
                "PATCH",
                "/api/settings",
                { startWithWindows: value },
                "Windows startup preference saved. This applies to the installed app.",
              )
            }
          />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-label">
          <Brain size={22} />
          <h3>Conversation memory</h3>
          <p>
            Let your assistant build on the things you have already discussed.
          </p>
        </div>
        <div className="settings-section-body">
          <Toggle
            checked={state.config.memoryEnabled !== false}
            onChange={(value) =>
              void perform(
                "PATCH",
                "/api/settings",
                { memoryEnabled: value },
                "Conversation memory preference saved.",
              )
            }
            label="Use recent conversation context"
            description="Include relevant recent conversation in AI requests. History remains stored locally on this PC when this preference is off."
          />
          <p className="small-copy">
            Context sent to an AI is processed under that provider’s account
            terms. Your host keeps local conversation records; this toggle
            controls reuse of context.
          </p>
        </div>
      </section>
      <CompanionMemorySettings />
      <section className="settings-section">
        <div className="settings-section-label">
          <Coins size={22} />
          <h3>Subscriptions & video credits</h3>
          <p>Use your existing subscriptions with £0 extra API spending.</p>
        </div>
        <div className="settings-section-body">
          <p className="small-copy">
            Codex and Claude use their verified subscription connections and
            never fall back to a paid API. Subscription limits still apply.
            Ordinary AI requests do not use a separate API budget.
          </p>
          <div className="settings-divider" />
          <h4>Kling video credits</h4>
          <p className="small-copy">
            Kling has its own account and spending switch in AI team → Kling
            video. It is disabled by default, and every video needs a fresh
            approval. ChatGPT and Claude subscriptions do not cover Kling
            credits. Nakama cannot quote the exact generation cost.
          </p>
          <TextLink onClick={() => navigate("agents")}>
            Open Kling video setup
          </TextLink>
        </div>
      </section>
    </>
  );
}
