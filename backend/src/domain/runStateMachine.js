const TRANSITIONS = {
  queued: ["running", "cancelled"],
  running: ["waiting_approval", "succeeded", "failed", "cancelled"],
  waiting_approval: ["queued", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run transition: ${from} -> ${to}`);
  }
}

export function isTerminal(status) {
  return TRANSITIONS[status]?.length === 0;
}
