import { Router } from "express";
import { validateQuery } from "../middleware/validate.js";
import { listApprovalsSchema } from "../validation/schemas.js";

export function approvalRoutes(controller) {
  const router = Router();

  router.get("/", validateQuery(listApprovalsSchema), controller.list);
  router.post("/:id/approve", controller.approve);
  router.post("/:id/reject", controller.reject);

  return router;
}
