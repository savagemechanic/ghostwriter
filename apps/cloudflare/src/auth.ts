import {
  OAuthProvider,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { equalSecret, escapeHtml, HttpError, readBounded } from "./security";
import type { Env } from "./index";
const cookieName = "__Host-ghostwriter-consent";
export async function authorize(
  request: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
) {
  const origin = new URL(request.url).origin;
  if (request.method === "GET") {
    const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    if (auth.codeChallengeMethod !== "S256" || !auth.codeChallenge)
      throw new HttpError(400, "S256 PKCE is required");
    if (
      !auth.scope.includes("ghostwriter") ||
      auth.scope.some((s) => s !== "ghostwriter")
    )
      throw new HttpError(400, "Request the ghostwriter scope");
    const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
    const nonce = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO oauth_pending(nonce,request_url,expires_at) VALUES(?,?,?)",
    )
      .bind(nonce, request.url, Date.now() + 600000)
      .run();
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Ghostwriter</title><body><main><h1>Connect Ghostwriter</h1><p>Client: ${escapeHtml(client?.clientName ?? auth.clientId)}</p><p>Return to: ${escapeHtml(new URL(auth.redirectUri).origin)}</p><p>This grants access to your creator identity, drafts, generation, metrics, and publishing tools. Publishing remains disabled unless enabled by the owner.</p><form method="post" action="/authorize"><input type="hidden" name="nonce" value="${nonce}"><label>Owner access key <input name="owner_key" type="password" required autocomplete="off"></label><button type="submit">Authorize this client</button></form></main></body></html>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        "set-cookie": `${cookieName}=${nonce}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
        "referrer-policy": "no-referrer",
      },
    });
  }
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (request.headers.get("origin") !== origin)
    throw new HttpError(403, "Invalid origin");
  const form = new URLSearchParams(
    new TextDecoder().decode(await readBounded(request.body, 16384)),
  );
  const nonce = form.get("nonce") ?? "";
  const cookie =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? "";
  if (!nonce || !cookie || !(await equalSecret(nonce, cookie)))
    throw new HttpError(403, "Invalid consent session");
  if (
    !(await equalSecret(
      form.get("owner_key") ?? "",
      env.GHOSTWRITER_ADMIN_TOKEN!,
    ))
  )
    throw new HttpError(401, "Invalid owner key");
  const pending = await env.DB.prepare(
    "DELETE FROM oauth_pending WHERE nonce=? AND expires_at>? RETURNING request_url",
  )
    .bind(nonce, Date.now())
    .first<{ request_url: string }>();
  if (!pending) throw new HttpError(400, "Consent expired or already used");
  const auth = await env.OAUTH_PROVIDER.parseAuthRequest(
    new Request(pending.request_url),
  );
  const result = await env.OAUTH_PROVIDER.completeAuthorization({
    request: auth,
    userId: "owner",
    metadata: {},
    scope: ["ghostwriter"],
    props: { userId: "owner", scope: ["ghostwriter"] },
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: result.redirectTo,
      "cache-control": "no-store",
      "set-cookie": `${cookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}
export function oauth(
  env: Env,
  origin: string,
  apiHandler: Required<Pick<ExportedHandler<Env>, "fetch">>,
  defaultHandler: Required<Pick<ExportedHandler<Env>, "fetch">>,
) {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    // DCR avoids fetching arbitrary client metadata URLs. Public clients must use S256 PKCE.
    clientIdMetadataDocumentEnabled: false,
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    scopesSupported: ["ghostwriter"],
    accessTokenTTL: 3600,
    refreshTokenTTL: 604800,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["ghostwriter"],
    },
  });
}
