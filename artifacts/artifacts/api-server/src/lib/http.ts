import type { Request, Response } from "express";

type RouteErrorOptions = {
  logMessage: string;
  publicMessage: string;
};

type ZodLikeIssue = {
  path?: unknown;
  message?: unknown;
  code?: unknown;
};

function isZodLikeError(err: unknown): err is { issues: ZodLikeIssue[] } {
  if (!err || typeof err !== "object") return false;
  if ((err as { name?: unknown }).name !== "ZodError") return false;
  return Array.isArray((err as { issues?: unknown }).issues);
}

export function handleRouteError(
  req: Request,
  res: Response,
  err: unknown,
  options: RouteErrorOptions,
) {
  if (isZodLikeError(err)) {
    req.log.warn({ issues: err.issues }, "Invalid request payload");
    res.status(400).json({ error: "Invalid request", issues: err.issues });
    return;
  }

  req.log.error({ err }, options.logMessage);
  res.status(500).json({ error: options.publicMessage });
}

export function isPgUniqueViolation(err: unknown) {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === "23505";
}
