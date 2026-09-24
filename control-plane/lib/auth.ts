import { timingSafeEqual } from "node:crypto";

export function isAuthorized(request: Request): boolean {
  const expected = process.env.CONTROL_API_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
