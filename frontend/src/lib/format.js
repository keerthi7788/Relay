const UNITS = [
  [60, "sec"],
  [3600, "min", 60],
  [86400, "hr", 3600],
  [Infinity, "day", 86400],
];

export function timeAgo(timestamp, now = Date.now()) {
  if (!timestamp) return "-";
  const seconds = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "Just now";
  for (const [limit, unit, divisor = 1] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)} ${unit} ago`;
  }
  return "-";
}

export function duration(ms) {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

const FAILURES = {
  max_steps_exceeded: "Stopped at the step limit",
  timeout_exceeded: "Stopped at the time limit",
  token_budget_exceeded: "Stopped at the AI token limit",
  approval_required: "Blocked: this action needs an approval",
  approval_rejected: "Rejected by the approver",
  cancelled: "Cancelled by an operator",
  ai_schema_violation: "The AI's answer failed its format check twice",
  retries_exhausted: "A step kept failing after all its tries",
  notify_target_blocked: "Blocked: this notify target isn't allowed",
  outbound_host_blocked: "Blocked: this host isn't allowed",
  template_unresolved: "A value this step needs wasn't in the input",
  upstream_rejected: "An outside service rejected the request",
};

export const failureText = (error) => error && (FAILURES[error.code] ?? error.message);
