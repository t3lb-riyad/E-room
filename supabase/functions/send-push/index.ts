// =========================================================================
// RoomSet — Supabase Edge Function: send-push
// Sends an FCM HTTP v1 push to every registered admin device.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// Required function secrets:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
//   WEBHOOK_SECRET, SITE_URL
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// =========================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL") ?? "";
const PRIVATE_KEY = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(
  /\\n/g,
  "\n",
);
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const encoder = new TextEncoder();

interface PushRecord {
  id?: string;
  type?: string;
  message?: string | null;
  created_at?: string;
}

interface PushResult {
  ok: boolean;
  invalid?: boolean;
  status?: number;
  error?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* -------------------------------------------------------------------------
   Google OAuth (service account -> FCM access token)
   ------------------------------------------------------------------------- */

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsigned = `${header}.${claims}`;

  // The JWT header uses the JOSE name "RS256", but Web Crypto expects the
  // underlying algorithm name "RSASSA-PKCS1-v1_5". Passing "RS256" here is
  // what causes Deno's NotSupportedError / Unrecognized algorithm name.
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Google OAuth failed (${response.status}): ${await response.text()}`,
    );
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return data.access_token;
}

/* -------------------------------------------------------------------------
   FCM send
   ------------------------------------------------------------------------- */

async function sendToToken(
  token: string,
  accessToken: string,
  record: PushRecord,
): Promise<PushResult> {
  const title = "تنبيه من زائر";
  const body =
    (record.message && String(record.message).trim()) ||
    "أحدهم يطلب انتباهك الآن.";

  const link = SITE_URL ? `${SITE_URL}/index.html` : undefined;

  const webpushNotification: Record<string, unknown> = {
    title,
    body,
    dir: "rtl",
    lang: "ar",
    vibrate: [120, 60, 120],
    tag: "roomset-ping",
    renotify: true,
  };

  if (SITE_URL) {
    webpushNotification.icon = `${SITE_URL}/icons/icon-192.png`;
    webpushNotification.badge = `${SITE_URL}/icons/badge-72.png`;
  }

  const message: Record<string, unknown> = {
    token,
    notification: { title, body },
    data: {
      title,
      body,
      type: record.type || "ping",
      notificationId: record.id || "",
      url: "./index.html",
    },
    webpush: {
      headers: { Urgency: "high", TTL: "3600" },
      notification: webpushNotification,
      ...(link ? { fcm_options: { link } } : {}),
    },
  };

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );

  if (response.ok) return { ok: true };

  const text = await response.text();
  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // keep raw text
  }

  const errorCode: string =
    payload?.error?.details?.[0]?.errorCode ||
    payload?.error?.status ||
    "";
  const invalid =
    response.status === 404 ||
    errorCode === "UNREGISTERED" ||
    (response.status === 400 && /registration token/i.test(text));

  return {
    ok: false,
    invalid,
    status: response.status,
    error: text.slice(0, 400),
  };
}

/* -------------------------------------------------------------------------
   HTTP handler
   ------------------------------------------------------------------------- */

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method === "GET") {
    return json({ ok: true, service: "roomset-send-push" });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const missing = [
    ["FIREBASE_PROJECT_ID", FIREBASE_PROJECT_ID],
    ["FIREBASE_CLIENT_EMAIL", CLIENT_EMAIL],
    ["FIREBASE_PRIVATE_KEY", PRIVATE_KEY],
    ["WEBHOOK_SECRET", WEBHOOK_SECRET],
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    return json({ error: `Missing secrets: ${missing.join(", ")}` }, 500);
  }

  if (!safeEqual(request.headers.get("x-webhook-secret") ?? "", WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const record: PushRecord = payload?.record ?? payload ?? {};

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: devices, error } = await supabase
      .from("devices")
      .select("token")
      .eq("role", "admin");

    if (error) throw error;

    const tokens = [
      ...new Set(
        (devices ?? [])
          .map((device: { token?: string }) => device.token)
          .filter((token): token is string => Boolean(token)),
      ),
    ];

    if (!tokens.length) {
      return json({ ok: true, sent: 0, reason: "no-admin-devices" });
    }

    const accessToken = await getAccessToken();

    const results = await Promise.all(
      tokens.map(async (token) => ({
        token,
        result: await sendToToken(token, accessToken, record),
      })),
    );

    const invalidTokens = results
      .filter((item) => !item.result.ok && item.result.invalid)
      .map((item) => item.token);

    if (invalidTokens.length) {
      await supabase.from("devices").delete().in("token", invalidTokens);
    }

    const sent = results.filter((item) => item.result.ok).length;
    const failed = results.length - sent;

    results
      .filter((item) => !item.result.ok)
      .forEach((item) => {
        console.error("[send-push] delivery failed", {
          status: item.result.status,
          error: item.result.error,
          token: `${item.token.slice(0, 12)}…`,
        });
      });

    return json({ ok: failed === 0, sent, failed, removed: invalidTokens.length });
  } catch (error) {
    console.error("[send-push] unexpected error", error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
