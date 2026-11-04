const LIMIT_RANGES = {
  max_steps: { min: 1, max: 500 },
  timeout_seconds: { min: 10, max: 3600 },
  max_ai_tokens: { min: 0, max: 100000 },
};
const RETRY_RANGES = {
  max_attempts: { min: 1, max: 5 },
  backoff_seconds: { min: 1, max: 30 },
};
const MAX_INPUT_KB_RANGE = { min: 1, max: 1024 };
const INJECTION_MODES = ["off", "flag", "require_approval"];

export const DEFAULT_TIMEOUT_SECONDS = 300;
export const DEFAULT_MAX_AI_TOKENS = 10000;
export const DEFAULT_MAX_INPUT_KB = 256;

const inRange = (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max;

const describe = ({ min, max }) => `an integer from ${min} to ${max}`;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function rangeErrors(values, ranges, prefix) {
  return Object.entries(ranges)
    .filter(([name]) => values[name] !== undefined && !inRange(values[name], ranges[name]))
    .map(([name, range]) => `${prefix}.${name} must be ${describe(range)}`);
}

export function guardrailErrors({ limits, guardrails }, catalog) {
  const errors = [];
  if (!isObject(limits)) return ["limits must be an object"];
  if (limits.max_steps === undefined) errors.push("limits.max_steps is required");
  errors.push(...rangeErrors(limits, LIMIT_RANGES, "limits"));

  if (guardrails === undefined) return errors;
  if (!isObject(guardrails)) return [...errors, "guardrails must be an object"];

  const { retry, injection_detection, allowed_notify_targets, require_approval_for } = guardrails;
  if (retry !== undefined) {
    if (isObject(retry)) errors.push(...rangeErrors(retry, RETRY_RANGES, "guardrails.retry"));
    else errors.push("guardrails.retry must be an object");
  }
  if (injection_detection !== undefined && !INJECTION_MODES.includes(injection_detection)) {
    errors.push(`guardrails.injection_detection must be one of ${INJECTION_MODES.join(", ")}`);
  }
  if (
    allowed_notify_targets !== undefined &&
    !(
      Array.isArray(allowed_notify_targets) &&
      allowed_notify_targets.every((target) => typeof target === "string" && target)
    )
  ) {
    errors.push("guardrails.allowed_notify_targets must be a list of patterns");
  }
  if (require_approval_for !== undefined) {
    const known = (type) => type !== "approval" && catalog.spec(type);
    if (!Array.isArray(require_approval_for) || !require_approval_for.every(known)) {
      errors.push("guardrails.require_approval_for must list node types other than approval");
    }
  }
  if (
    guardrails.strip_links_from_ai_text !== undefined &&
    typeof guardrails.strip_links_from_ai_text !== "boolean"
  ) {
    errors.push("guardrails.strip_links_from_ai_text must be true or false");
  }
  if (
    guardrails.max_input_kb !== undefined &&
    !inRange(guardrails.max_input_kb, MAX_INPUT_KB_RANGE)
  ) {
    errors.push(`guardrails.max_input_kb must be ${describe(MAX_INPUT_KB_RANGE)}`);
  }
  return errors;
}

export function settingsFor({ limits, guardrails = {} }) {
  return {
    maxSteps: limits.max_steps,
    timeoutSeconds: limits.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
    maxAiTokens: limits.max_ai_tokens ?? DEFAULT_MAX_AI_TOKENS,
    retry: guardrails.retry ?? {},
    injectionDetection: guardrails.injection_detection ?? "flag",
    allowedNotifyTargets: guardrails.allowed_notify_targets ?? [],
    requireApprovalFor: guardrails.require_approval_for ?? [],
    stripLinks: guardrails.strip_links_from_ai_text ?? true,
    maxInputKb: guardrails.max_input_kb ?? DEFAULT_MAX_INPUT_KB,
  };
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function isNotifyTargetAllowed(target, patterns) {
  return patterns.length === 0 || patterns.some((pattern) => patternToRegex(pattern).test(target));
}
