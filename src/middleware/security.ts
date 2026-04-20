import { slidingWindow } from "@arcjet/node";
import type { ArcjetNodeRequest } from "@arcjet/node";
import type { NextFunction, Request, Response } from "express";

import aj from "../config/arcjet.js";

const securityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Skip security middleware outside production
  if (process.env.NODE_ENV !== "production") {
    return next();
  }

  // Ignore CORS preflight requests
  if (req.method === "OPTIONS") {
    return next();
  }

  try {
    const role: RateLimitRole = req.user?.role ?? "guest";

    let limit: number;
    let message: string;

    switch (role) {
      case "admin":
        limit = 100;
        message = "Admin request limit exceeded (100 per minute). Slow down.";
        break;

      case "teacher":
      case "student":
        limit = 60;
        message = "User request limit exceeded (60 per minute). Please wait.";
        break;

      default:
        if (
          req.method === "GET" &&
          (req.path.startsWith("/api/subjects") ||
            req.path.startsWith("/api/classes"))
        ) {
          limit = 60;
          message =
            "Guest public read limit exceeded (60 per minute). Please wait.";
        } else {
          limit = 10;
          message =
            "Guest request limit exceeded (10 per minute). Please wait.";
        }
        break;
    }

    const client = aj.withRule(
      slidingWindow({
        mode: "LIVE",
        interval: "1m",
        max: limit,
      }),
    );

    const arcjetRequest: ArcjetNodeRequest = {
      headers: req.headers,
      method: req.method,
      url: req.originalUrl ?? req.url,
      socket: {
        remoteAddress: req.socket.remoteAddress ?? req.ip ?? "0.0.0.0",
      },
    };

    const decision = await client.protect(arcjetRequest);

    if (decision.isDenied() && decision.reason.isBot()) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Automated requests are not allowed",
      });
    }

    if (decision.isDenied() && decision.reason.isShield()) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Request blocked by security policy",
      });
    }

    if (decision.isDenied() && decision.reason.isRateLimit()) {
      return res.status(429).json({
        error: "Too Many Requests",
        message,
      });
    }

    return next();
  } catch (error) {
    console.error("Arcjet middleware error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Something went wrong with the security middleware.",
    });
  }
};

export default securityMiddleware;
