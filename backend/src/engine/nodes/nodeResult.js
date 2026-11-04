export const completed = (output, trace = {}) => ({ kind: "completed", output, ...trace });
export const suspended = (until) => ({ kind: "suspended", until });
export const awaitingApproval = (message) => ({ kind: "awaiting_approval", message });

export function sideEffectTrace(response) {
  return {
    attempts: [{ at: new Date().toISOString(), outcome: "succeeded", replayed: response.replayed }],
  };
}
