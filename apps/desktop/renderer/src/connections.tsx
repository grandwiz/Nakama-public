import { useState } from "react";
import {
  ArrowRight,
  Clock,
  Code2,
  Info,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button, Modal, SectionTitle, Status, TextLink } from "./components";
import { useNakama } from "./context";
import { openExternal } from "./bridge";
import { GoogleConnect, GooglePanel } from "./google";
import type { Connection } from "./types";
import { ServiceExplorer, type ServiceSelection } from "./services";

const descriptions: Record<string, string> = {
  vercel: "Deploy your websites and applications.",
  render: "Web services, background workers, and hosting.",
  resend: "Transactional email for the things you build.",
  github: "Repositories, project code, and collaboration.",
  neon: "Postgres databases for your applications.",
  gmail: "Your personal inboxes, together in one place.",
  calendar: "Appointments and plans across your Google accounts.",
  kling: "Create videos with your Kling account and explicit approval.",
};
const urls: Record<string, string> = {
  vercel: "https://vercel.com/account/tokens",
  render: "https://dashboard.render.com/u/settings",
  resend: "https://resend.com/api-keys",
  github: "https://github.com/settings/personal-access-tokens",
  neon: "https://console.neon.tech/app/settings/api-keys",
};
export function ConnectionsPage() {
  const { state, navigate } = useNakama();
  const [selected, setSelected] = useState<string>();
  const [google, setGoogle] = useState<{ service?: string }>();
  const [explore, setExplore] = useState<ServiceSelection>();
  const connection = state.connections.find((item) => item.id === selected);
  return (
    <div className="page-enter">
      <SectionTitle
        eyebrow="A LITTLE MORE CONNECTED"
        title="Your apps, working together"
        description="Connect the tools you use for building, organising, and getting things done."
      />
      <div className="connection-info">
        <ShieldCheck size={20} />
        <p>
          Credentials stay with your Windows host. Add and verify each
          development account separately. Connect Google accounts through
          Google’s own consent screen.
        </p>
      </div>
      <div className="connections-grid">
        {state.connections.map((item, index) => (
          <section className="connection-card" key={item.id}>
            <div className="connection-card-top">
              <span className={`integration-icon integration-${index}`}>
                {item.id === "gmail" ? (
                  <Mail size={25} />
                ) : item.id === "calendar" ? (
                  <Clock size={25} />
                ) : item.id === "github" ? (
                  <Code2 size={25} />
                ) : (
                  <span>{item.name.slice(0, 1)}</span>
                )}
              </span>
              <Status value={item.status} />
            </div>
            <h3>{item.name}</h3>
            <p>
              {descriptions[item.id] ||
                item.detail ||
                "Connect this service to your workspace."}
            </p>
            {item.accountLabel && (
              <div className="account-label">
                <span className="avatar small">
                  {item.accountLabel.slice(0, 1).toUpperCase()}
                </span>
                {item.accountLabel}
              </div>
            )}
            <div className="connection-card-footer">
              <span>
                {item.accounts?.length
                  ? `${item.accounts.length} ${item.accounts.length === 1 ? "account" : "accounts"}`
                  : item.category ||
                    (["gmail", "calendar"].includes(item.id)
                      ? "Personal assistant"
                      : "Development")}
              </span>
              <Button
                kind="secondary"
                onClick={() =>
                  item.id === "chrome"
                    ? navigate("devices")
                    : item.id === "kling"
                      ? navigate("agents")
                      : ["gmail", "calendar"].includes(item.id)
                        ? setGoogle({ service: item.id })
                        : setSelected(item.id)
                }
              >
                {item.accounts?.length
                  ? "Manage accounts"
                  : ["gmail", "calendar"].includes(item.id)
                    ? "Add account"
                    : "Set up"}
                <ArrowRight size={14} />
              </Button>
            </div>
          </section>
        ))}
      </div>
      <GooglePanel onConnect={() => setGoogle({})} />
      <section className="panel accounts-note">
        <div className="stat-icon blue">
          <Mail size={23} />
        </div>
        <div>
          <h3>Personal life. Business account. Separate connections.</h3>
          <p>
            Gmail and Google Calendar keep their own account connections. Add
            personal or business Google accounts, then choose the account before
            reading email or creating an event.
          </p>
        </div>
      </section>
      {connection && (
        <ConnectionSetup
          connection={connection}
          onExplore={(accountId, label) => {
            setExplore({ provider: connection.id, accountId, label });
            setSelected(undefined);
          }}
          onClose={() => setSelected(undefined)}
        />
      )}{" "}
      {google && (
        <GoogleConnect
          service={google.service}
          onClose={() => setGoogle(undefined)}
        />
      )}
      {explore && (
        <ServiceExplorer
          selection={explore}
          onClose={() => setExplore(undefined)}
        />
      )}
    </div>
  );
}
function ConnectionSetup({
  connection,
  onClose,
  onExplore,
}: {
  connection: Connection;
  onClose: () => void;
  onExplore: (accountId: string, label: string) => void;
}) {
  const { perform } = useNakama();
  const [accountLabel, setAccountLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string>();
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await perform(
      "POST",
      `/api/connections/${connection.id}`,
      { accountLabel: accountLabel.trim(), token },
      "Account credential stored. Verify it below before use.",
    );
    setBusy(false);
    if (result) {
      setToken("");
      setAccountLabel("");
    }
  };
  const verify = async (accountId: string) => {
    setTesting(accountId);
    await perform(
      "POST",
      `/api/connections/${connection.id}/test`,
      { accountId },
      "Credential verified with the service.",
    );
    setTesting(undefined);
  };
  return (
    <Modal
      title={`${connection.name} accounts`}
      description="Add a labelled account and store its token in the Windows credential vault. Tokens are never displayed back to this interface."
      onClose={onClose}
    >
      {(connection.accounts || []).length > 0 && (
        <div className="saved-accounts">
          {connection.accounts!.map((account) => (
            <div className="saved-account" key={account.id}>
              <span className="saved-account-icon">
                <KeyRound size={17} />
              </span>
              <span>
                <strong>{account.accountLabel}</strong>
                <Status value={account.status} />
              </span>
              <Button
                kind="secondary"
                busy={testing === account.id}
                onClick={() => void verify(account.id)}
              >
                <RefreshCw size={13} />
                Verify
              </Button>
              <Button
                kind="secondary"
                onClick={() => onExplore(account.id, account.accountLabel)}
              >
                Explore
                <ArrowRight size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={(event) => void save(event)}>
        <h3 className="form-subtitle">Add an account</h3>
        {connection.id === "github" && (
          <p className="small-copy">
            Use a GitHub personal access token restricted to the repositories
            you want Nakama to access. Read access supports importing and
            pulling; pushing needs Contents write access. Organisation policies
            and branch rules still apply. Then open Projects → Import from
            GitHub, or a project's Git changes to link an existing checkout.
          </p>
        )}
        <label className="field">
          Account label
          <input
            autoFocus
            required
            value={accountLabel}
            onChange={(event) => setAccountLabel(event.target.value)}
            placeholder="My account or organisation"
            maxLength={120}
          />
        </label>
        <label className="field">
          API token
          <input
            required
            autoComplete="off"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste a token to store securely"
          />
          <small>
            Use a token with the permissions you need. Verification makes a
            read-only request to the service.
          </small>
        </label>
        <div className="inline-note">
          <Info size={17} />
          <span>
            Verifying a token confirms account access. It does not deploy a
            project or enable every provider action. Deployment requests still
            require your approval and a configured executor.
          </span>
        </div>
        {urls[connection.id] && (
          <TextLink
            external
            onClick={() => void openExternal(urls[connection.id])}
          >
            Open {connection.name} token settings
          </TextLink>
        )}
        <div className="modal-actions">
          <Button kind="secondary" type="button" onClick={onClose}>
            Done
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={!accountLabel.trim() || !token.trim()}
          >
            <Plus size={15} />
            Add account
          </Button>
        </div>
      </form>
    </Modal>
  );
}
