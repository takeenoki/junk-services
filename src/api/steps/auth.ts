export interface StepsAuthEnv {
  STEPS_GOOGLE_CLIENT_ID?: string;
  STEPS_GOOGLE_SUB?: string;
}

export class AuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type GoogleKey = JsonWebKey & { kid: string };
let cachedKeys: { keys: GoogleKey[]; expires: number } | undefined;

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}

async function getKeys(): Promise<GoogleKey[]> {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) throw new Error("Key service unavailable");
    const body = await response.json() as { keys: GoogleKey[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error("Invalid key set");
    const maxAge = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] ?? 300);
    cachedKeys = { keys: body.keys, expires: Date.now() + Math.min(maxAge, 86400) * 1000 };
    return body.keys;
  } catch {
    throw new AuthError(503, "SERVICE_UNAVAILABLE");
  }
}

export async function authorize(request: Request, env: StepsAuthEnv): Promise<void> {
  if (!env.STEPS_GOOGLE_CLIENT_ID || !env.STEPS_GOOGLE_SUB) {
    throw new AuthError(503, "SERVICE_UNAVAILABLE");
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
  if (!token || token.length > 16384) throw new AuthError(401, "AUTH_INVALID");
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid algorithm");
    const keys = await getKeys();
    const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256" && key.use === "sig");
    if (!jwk) throw new Error("Unknown key");
    const key = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Date.now() / 1000;
    if (!valid || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)
      || claims.aud !== env.STEPS_GOOGLE_CLIENT_ID
      || typeof claims.exp !== "number" || claims.exp <= now
      || typeof claims.iat !== "number" || claims.iat > now + 60
      || typeof claims.sub !== "string" || !claims.sub
      || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now))) {
      throw new Error("Invalid claims");
    }
    if (claims.sub !== env.STEPS_GOOGLE_SUB) throw new AuthError(403, "FORBIDDEN");
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, "AUTH_INVALID");
  }
}
