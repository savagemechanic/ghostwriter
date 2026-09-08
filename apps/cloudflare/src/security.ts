import { timingSafeEqual } from "node:crypto";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function equalSecret(actual: string, expected: string) {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all(
    [actual, expected].map((s) =>
      crypto.subtle.digest("SHA-256", encode.encode(s)),
    ),
  );
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "Payload too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function publicEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":")
  )
    throw new Error("Provider URL must be a public HTTPS hostname");
  return url;
}
export function hasAdminToken(env: { GHOSTWRITER_ADMIN_TOKEN?: string }) {
  return (env.GHOSTWRITER_ADMIN_TOKEN?.length ?? 0) >= 24;
}
export async function requireAdmin(
  request: Request,
  env: { GHOSTWRITER_ADMIN_TOKEN?: string },
) {
  if (!hasAdminToken(env))
    throw new HttpError(503, "Authentication not configured");
  if (
    !(await equalSecret(
      request.headers.get("authorization") ?? "",
      `Bearer ${env.GHOSTWRITER_ADMIN_TOKEN}`,
    ))
  )
    throw new HttpError(401, "Unauthorized");
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
