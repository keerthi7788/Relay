import { Router } from "express";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../validation/schemas.js";

export function authRoutes(controller, authenticated, loginLimit) {
  const router = Router();

  router.post("/login", loginLimit, validateBody(loginSchema), controller.login);
  router.get("/me", authenticated, controller.me);

  return router;
}
