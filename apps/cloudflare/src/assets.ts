import { HttpError, readBounded } from "./security";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function validateJpeg(bytes: Uint8Array) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[2] !== 255
  )
    throw new HttpError(415, "A JPEG image is required");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new HttpError(413, "Image too large");
}
export async function storeAsset(
  env: { ASSETS: R2Bucket; DB: D1Database },
  key: string,
  bytes: Uint8Array,
  origin: string,
) {
  validateJpeg(bytes);
  const url = `${origin}/assets/${encodeURIComponent(key)}`;
  const object = await env.ASSETS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/jpeg" },
  });
  if (!object) throw new HttpError(409, "Asset already exists; use a new key");
  await env.DB.prepare(
    "INSERT INTO assets(id,r2_key,content_type,public_url) VALUES(?,?,?,?)",
  )
    .bind(crypto.randomUUID(), key, "image/jpeg", url)
    .run();
  return { key, url, contentType: "image/jpeg" };
}
export async function uploadAsset(
  request: Request,
  env: { ASSETS: R2Bucket; DB: D1Database },
  key: string,
  origin: string,
) {
  if (request.headers.get("content-type")?.split(";")[0] !== "image/jpeg")
    throw new HttpError(415, "Only JPEG assets are accepted for Instagram");
  return Response.json(
    await storeAsset(
      env,
      key,
      await readBounded(request.body, MAX_IMAGE_BYTES),
      origin,
    ),
  );
}
