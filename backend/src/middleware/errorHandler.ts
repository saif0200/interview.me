import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: env.NODE_ENV === "production" ? "Internal server error" : err.message,
    ...(env.NODE_ENV !== "production" && { stack: err.stack }),
  });
}
