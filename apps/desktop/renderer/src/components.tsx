import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronRight, Loader2, X } from "lucide-react";

export function Mascot({
  size = 96,
  awake = false,
  tone = "blue",
}: {
  size?: number;
  awake?: boolean;
  tone?: "blue" | "green" | "orange";
}) {
  const gradientId = useId();
  const colors =
    tone === "green"
      ? ["#a2e6b9", "#369d78", "#dcf7de", "#bce8ce", "#66bf94", "#398c6c"]
      : tone === "orange"
        ? ["#ffd29e", "#db8c58", "#fff0d6", "#ffe0c2", "#ecb279", "#c27c51"]
        : ["#88dcff", "#5678ee", "#b8efff", "#c0dcff", "#78b7fa", "#607fe8"];
  return (
    <svg
      className={`mascot ${awake ? "mascot-awake" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`Nakama, your ${tone} companion`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={colors[0]} />
          <stop offset="1" stopColor={colors[1]} />
        </linearGradient>
      </defs>
      <ellipse
        className="mascot-shadow"
        cx="60"
        cy="106"
        rx="29"
        ry="5"
        fill="#16284d"
        opacity=".16"
      />
      <g className="mascot-body">
        <path
          d="M31 40 Q19 4 40 21 L49 33 Q61 29 73 34 L88 20 Q105 11 93 45 Q106 61 96 84 Q92 99 73 100 L46 100 Q26 98 23 80 Q15 56 31 40Z"
          fill={`url(#${gradientId})`}
        />
        <path d="M29 42 Q31 25 39 29 L42 38" fill={colors[2]} opacity=".7" />
        <path d="M80 37 L89 27 L88 45" fill={colors[2]} opacity=".65" />
        <ellipse cx="39" cy="78" rx="7" ry="4" fill={colors[3]} opacity=".6" />
        <ellipse cx="82" cy="78" rx="7" ry="4" fill={colors[3]} opacity=".6" />
        <g className="mascot-eyes">
          <rect x="39" y="56" width="8" height="16" rx="4" fill="#152747" />
          <rect x="75" y="56" width="8" height="16" rx="4" fill="#152747" />
          <circle cx="42" cy="60" r="1.5" fill="white" />
          <circle cx="78" cy="60" r="1.5" fill="white" />
        </g>
        <path
          d="M55 76 Q61 82 67 76"
          fill="none"
          stroke="#25365e"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M24 67 Q10 64 15 79 Q19 85 26 82M96 66 Q109 62 106 77 Q102 84 96 81"
          fill={colors[4]}
        />
        <path
          d="M39 97 L36 103 Q45 108 51 100M72 100 Q81 109 87 102 L82 97"
          fill={colors[5]}
        />
      </g>
    </svg>
  );
}
export function Status({ value, label }: { value: string; label?: string }) {
  const positive = [
    "ready",
    "connected",
    "online",
    "completed",
    "approved",
    "verified",
    "success",
  ].includes(value);
  const active = [
    "running",
    "pending",
    "queued",
    "working",
    "awaiting_approval",
  ].includes(value);
  const negative = ["error", "failed", "denied", "revoked"].includes(value);
  return (
    <span
      className={`status ${positive ? "positive" : active ? "active" : negative ? "negative" : "neutral"}`}
    >
      <i />
      {label || value.replaceAll("_", " ")}
    </span>
  );
}
export function Button({
  children,
  kind = "primary",
  className = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${kind} ${className}`}
    >
      {busy && <Loader2 size={15} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  children,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      className={`icon-button ${props.className || ""}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row ${disabled ? "disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true">
        <Check size={13} />
      </span>
    </label>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function TextLink({
  children,
  onClick,
  external = false,
}: {
  children: ReactNode;
  onClick: () => void;
  external?: boolean;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      {external ? <ArrowUpRight size={15} /> : <ChevronRight size={15} />}
    </button>
  );
}
export function relativeDate(value?: string) {
  if (!value) return "Not seen yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60000) return "Just now";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} min ago`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} hr ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
