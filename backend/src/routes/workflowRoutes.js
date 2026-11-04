import { Router } from "express";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  createWorkflowSchema,
  listWorkflowsSchema,
  triggerSchema,
  updateGuardrailsSchema,
  updateTriggerSchema,
  updateWorkflowSchema,
} from "../validation/schemas.js";

export function workflowRoutes(controller) {
  const router = Router();

  router.get("/", validateQuery(listWorkflowsSchema), controller.list);
  router.post("/", validateBody(createWorkflowSchema), controller.create);
  router.get("/:id", controller.get);
  router.put("/:id", validateBody(updateWorkflowSchema), controller.update);
  router.post("/:id/publish", controller.publish);
  router.post("/:id/trigger", validateBody(triggerSchema), controller.trigger);
  router.put("/:id/trigger", validateBody(updateTriggerSchema), controller.updateTrigger);
  router.post("/:id/trigger/rotate-secret", controller.rotateSecret);
  router.put("/:id/guardrails", validateBody(updateGuardrailsSchema), controller.updateGuardrails);

  return router;
}
