import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const BUTTON_STYLES = {
  primary: "bg-accent text-white border-accent hover:bg-accent-dark",
  secondary: "bg-white text-ink border-control hover:bg-ground",
  danger: "bg-white text-danger border-danger hover:bg-danger-soft",
};

function buttonClass(kind) {
  return `inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold no-underline disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[kind]}`;
}

export function Button({ kind = "secondary", to, ...props }) {
  if (to) return <Link to={to} className={buttonClass(kind)} {...props} />;
  return <button type="button" className={buttonClass(kind)} {...props} />;
}

const STATUS = {
  queued: ["Queued", "text-muted bg-[#e7ebe9]"],
  running: ["Running", "text-info bg-info-soft"],
  waiting_approval: ["Waiting approval", "text-warn bg-warn-soft"],
  waiting: ["Waiting", "text-warn bg-warn-soft"],
  succeeded: ["Succeeded", "text-good bg-good-soft"],
  failed: ["Failed", "text-danger bg-danger-soft"],
  cancelled: ["Cancelled", "text-[#2f3936] bg-[#d5dad8]"],
  published: ["Published", "text-good bg-good-soft"],
  draft: ["Draft", "text-muted bg-[#e7ebe9]"],
};

export function StatusPill({ status }) {
  const [label, style] = STATUS[status] ?? [status, STATUS.queued[1]];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}
    >
      <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
      {label}
    </span>
  );
}

const TAG_STYLES = {
  plain: "text-muted bg-[#eaeeec]",
  accent: "text-accent bg-accent-soft",
  warn: "text-warn bg-warn-soft",
  info: "text-info bg-info-soft",
};

export function Tag({ tone = "plain", children }) {
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${TAG_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className = "" }) {
  return <span className={`font-mono text-xs text-muted ${className}`}>{children}</span>;
}

export function Card({ title, action, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-white p-5">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeading({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const BANNER_STYLES = {
  error: "text-[#7c1612] bg-danger-soft",
  warn: "text-warn bg-warn-soft",
  good: "text-good bg-good-soft",
};

export function Banner({ tone = "warn", children, action }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-[13px] font-semibold ${BANNER_STYLES[tone]}`}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

export function LoadError({ error }) {
  if (!error) return null;
  const text =
    error.code === "unreachable"
      ? "Can't reach Relay. Your data may be out of date. Retrying."
      : error.message;
  return <Banner tone="error">{text}</Banner>;
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-lg border border-line bg-white px-5 py-9 text-center">
      <strong className="text-[15px] font-semibold">{title}</strong>
      <span className="text-[13px] text-muted">{text}</span>
      {action}
    </div>
  );
}

export function Skeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex animate-pulse flex-col gap-3.5 rounded-lg border border-line bg-white p-5"
    >
      {["w-[70%]", "w-[90%]", "w-[55%]", "w-[80%]"].map((width) => (
        <span key={width} className={`block h-3 rounded bg-[#e4e9e6] ${width}`} />
      ))}
    </div>
  );
}

export function CodeBlock({ children }) {
  return (
    <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#e2e7e4] bg-[#f1f4f2] px-3.5 py-3 font-mono text-xs leading-relaxed">
      {typeof children === "string" ? children : JSON.stringify(children, null, 2)}
    </pre>
  );
}

const CONTROL =
  "w-full rounded-md border border-control bg-white px-3 py-2 text-[13px] min-h-[38px]";

export function Field({ label, id, hint, error, ...props }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        className={`${CONTROL} ${props.mono ? "font-mono" : ""}`}
        {...props}
        mono={undefined}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-xs font-semibold text-danger">{error}</span>}
    </div>
  );
}

export function TextArea({ label, id, hint, error, rows = 5, ...props }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className={`${CONTROL} resize-y font-mono text-xs leading-relaxed`}
        {...props}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-xs font-semibold text-danger">{error}</span>}
    </div>
  );
}

export function Select({ label, id, hint, options, ...props }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <select id={id} className={CONTROL} {...props}>
        {options.map(({ value, label: text }) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="flex min-h-7 items-center gap-2.5 text-sm">
      <input type="checkbox" className="size-[18px] accent-accent" {...props} />
      {label}
    </label>
  );
}

export function Dialog({ title, children, actions }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[10px] border border-control bg-white p-5 backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-3">
        <strong className="text-base font-semibold">{title}</strong>
        <div className="text-sm">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    await onConfirm();
  };

  return (
    <Dialog
      title={title}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} onClick={confirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {text}
    </Dialog>
  );
}

export function SecretDialog({ secret, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  };

  return (
    <Dialog
      title="Copy your webhook secret"
      actions={
        <>
          <Button onClick={copy}>{copied ? "Copied" : "Copy secret"}</Button>
          <Button kind="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p>This is the only time it will be shown. Any older secret has stopped working.</p>
        <CodeBlock>{secret}</CodeBlock>
      </div>
    </Dialog>
  );
}

export function Table({ headers, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="whitespace-nowrap border-b border-line px-3.5 py-2.5 text-left text-xs font-semibold text-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-[#e9edeb] [&_td]:px-3.5 [&_td]:py-3 [&_td]:align-middle [&_td]:text-[13px] [&_tr:last-child_td]:border-b-0">
          {children}
        </tbody>
      </table>
    </div>
  );
}
