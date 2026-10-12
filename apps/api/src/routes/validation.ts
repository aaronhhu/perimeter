import type { Response } from "express";
import type { z } from "zod";

export function badRequest(res: Response, error: string, zodError: z.ZodError): void {
  res.status(400).json({
    error,
    issues: zodError.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}
