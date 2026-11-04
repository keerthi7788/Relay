import { z } from "zod";

const jsonObject = z.record(z.string(), z.unknown());
const triggerShape = z.object({ secret: z.string().min(1).optional() }).passthrough();

const definitionFields = { trigger: triggerShape.optional() };

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;
const page = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
};

export const createWorkflowSchema = z
  .object({ id: z.string().regex(/^[\w-]+$/), ...definitionFields })
  .passthrough();
export const updateWorkflowSchema = z.object(definitionFields).passthrough();
export const updateTriggerSchema = triggerShape.extend({ type: z.string() });
export const updateGuardrailsSchema = z
  .object({ limits: jsonObject.optional(), guardrails: jsonObject.optional() })
  .refine(({ limits, guardrails }) => limits || guardrails, {
    message: "Send limits, guardrails or both",
  });
export const triggerSchema = z.object({ input: jsonObject.default({}) });
export const webhookPayloadSchema = jsonObject;
export const loginSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});
export const listWorkflowsSchema = z.object(page);
export const listSamplesSchema = z.object({ workflowId: z.string().optional() });
export const listRunsSchema = z.object({
  ...page,
  workflowId: z.string().optional(),
  status: z
    .enum(["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"])
    .optional(),
});
export const listApprovalsSchema = z.object({
  ...page,
  status: z.enum(["pending", "approved", "rejected", "closed"]).default("pending"),
});
