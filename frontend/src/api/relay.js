import { request } from "./client.js";

function withQuery(path, params) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
  ).toString();
  return query ? `${path}?${query}` : path;
}

const workflow = (id) => `/workflows/${encodeURIComponent(id)}`;

export const relay = {
  login: (email, password) => request("POST", "/auth/login", { email, password }),
  me: () => request("GET", "/auth/me"),

  catalog: () => request("GET", "/catalog"),
  samplePayloads: (workflowId) => request("GET", withQuery("/sample-payloads", { workflowId })),

  listWorkflows: (params = {}) => request("GET", withQuery("/workflows", params)),
  getWorkflow: (id) => request("GET", workflow(id)),
  createWorkflow: (definition) => request("POST", "/workflows", definition),
  updateWorkflow: (id, definition) => request("PUT", workflow(id), definition),
  updateGuardrails: (id, settings) => request("PUT", `${workflow(id)}/guardrails`, settings),
  updateTrigger: (id, trigger) => request("PUT", `${workflow(id)}/trigger`, trigger),
  rotateSecret: (id) => request("POST", `${workflow(id)}/trigger/rotate-secret`),
  publishWorkflow: (id) => request("POST", `${workflow(id)}/publish`),
  triggerRun: (id, input) => request("POST", `${workflow(id)}/trigger`, { input }),

  listRuns: (params = {}) => request("GET", withQuery("/runs", params)),
  getRun: (id) => request("GET", `/runs/${encodeURIComponent(id)}`),
  cancelRun: (id) => request("POST", `/runs/${encodeURIComponent(id)}/cancel`),

  listApprovals: (params = {}) => request("GET", withQuery("/approvals", params)),
  approve: (id) => request("POST", `/approvals/${encodeURIComponent(id)}/approve`),
  reject: (id) => request("POST", `/approvals/${encodeURIComponent(id)}/reject`),
};
