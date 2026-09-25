/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./authRoutes";
import {
  getUserById,
  updateProfile,
  changePassword,
  deleteAccount,
  AuthError,
  type RequestMeta,
} from "./authService";
import { sessionCookieOptions } from "./authService";
import { env } from "./env";
import { logger } from "./logger";

const router = Router();

function metaOf(req: Request): RequestMeta {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    userAgent: req.headers["user-agent"],
  };
}

function handleError(res: Response, err: unknown) {
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error("Account route error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again.", code: "internal" });
}

router.use(requireAuth);

// ── Get own profile ──
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "Account not found.", code: "no_user" });
    res.json({ user });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Update profile (name) ──
router.patch("/profile", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const { name } = req.body || {};
    const user = await updateProfile(userId, { name });
    res.json({ success: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Change password ──
router.post("/change-password", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required.", code: "missing_fields" });
    }
    await changePassword(userId, { currentPassword, newPassword }, metaOf(req));
    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Delete account ──
router.delete("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Password confirmation is required.", code: "missing_fields" });
    await deleteAccount(userId, { password }, metaOf(req));
    res.clearCookie(env.auth.cookieName, { ...sessionCookieOptions(), maxAge: undefined });
    res.clearCookie("nexaleadai_session", { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ success: true, message: "Your account has been deleted." });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
