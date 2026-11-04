import { Router } from "express";
import { validateQuery } from "../middleware/validate.js";
import { listSamplesSchema } from "../validation/schemas.js";

export function catalogRoutes(controller, authenticated) {
  const router = Router();

  router.get("/catalog", authenticated, controller.get);
  router.get(
    "/sample-payloads",
    authenticated,
    validateQuery(listSamplesSchema),
    controller.samplePayloads,
  );

  return router;
}
