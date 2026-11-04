import { Router } from "express";

export function healthRoutes(controller) {
  const router = Router();

  router.get("/health", controller.check);
  router.get("/ready", controller.ready);

  return router;
}
