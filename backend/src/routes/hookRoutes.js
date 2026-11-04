import { Router } from "express";
import { requireBody } from "../middleware/requestGuards.js";
import { validateBody } from "../middleware/validate.js";
import { webhookPayloadSchema } from "../validation/schemas.js";

export function hookRoutes(controller) {
  const router = Router();

  router.post("/:id", requireBody, validateBody(webhookPayloadSchema), controller.trigger);

  return router;
}
