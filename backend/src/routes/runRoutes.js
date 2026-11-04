import { Router } from "express";
import { validateQuery } from "../middleware/validate.js";
import { listRunsSchema } from "../validation/schemas.js";

export function runRoutes(controller) {
  const router = Router();

  router.get("/", validateQuery(listRunsSchema), controller.list);
  router.get("/:id", controller.get);
  router.post("/:id/cancel", controller.cancel);

  return router;
}
