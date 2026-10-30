import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const STATUSES = Object.freeze([
  {
    id: "in_room",
    label: "في الغرفة",
    description: "",
    led: "#3DDC84",
    canNotify: true,
  },
  {
    id: "out_no_phone",
    label: "خارج بدون هاتف",
    description: "",
    led: "#FF5A5F",
    canNotify: false,
  },
  {
    id: "out_with_phone",
    label: "خارج معي الهاتف",
    description: "",
    led: "#58A6FF",
    canNotify: true,
  },
  {
    id: "university",
    label: "في الجامعة",
    description: "",
    led: "#FFFFFF",
    canNotify: true,
  },
]);

export const TABLES = Object.freeze({
  status: "admin_status",
  devices: "devices",
  notifications: "notifications",
});

const CONFIG = (typeof self !== "undefined" && self.APP_CONFIG) || {};
const SB = CONFIG.supabase || {};
const FB = CONFIG.firebase || {};
const PLACEHOLDER = /(YOUR[_-]|PASTE[_-]|your-project|example\.supabase)/i;

export const APP_SETTINGS = Object.freeze({
  pingCooldownMs: Number(CONFIG.app && CONFIG.app.pingCooldownMs) || 20000,
  defaultStatus: (CONFIG.app && CONFIG.app.defaultStatus) || "in_room",
});

export const DEFAULT_STATUS =
  STATUSES.find((item) => item.id === APP_SETTINGS.defaultStatus) || STATUSES[0];

export function statusById(id) {
  return STATUSES.find((item) => item.id === id) || DEFAULT_STATUS;
}

export const isSupabaseConfigured = Boolean(
  typeof SB.url === "string" &&
    /^https:\/\//i.test(SB.url) &&
    typeof SB.anonKey === "string" &&
    SB.anonKey.length > 20 &&
    !PLACEHOLDER.test(SB.url) &&
    !PLACEHOLDER.test(SB.anonKey),
);

function isRealFirebaseValue(value) {
  return typeof value === "string" && value.length > 0 && !PLACEHOLDER.test(value);
}

export const isFirebaseAppConfigured = Boolean(
  isRealFirebaseValue(FB.apiKey) &&
    isRealFirebaseValue(FB.projectId) &&
    isRealFirebaseValue(FB.messagingSenderId) &&
    isRealFirebaseValue(FB.appId),
);

export const hasVapidKey = isRealFirebaseValue(FB.vapidKey);

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(SB.url, SB.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  } catch (error) {
    console.error("[RoomSet] Supabase init failed:", error);
  }
}

export function getSupabase() {
  return supabase;
}

const DEMO_STATUS_KEY = "roomset:demo:status";
const DEMO_PING_KEY = "roomset:demo:pings";
const DEMO_EVENT = "roomset:demo-status";
const demoChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("roomset-demo") : null;

function demoRead() {
  try {
    const raw = localStorage.getItem(DEMO_STATUS_KEY);
    if (raw) return normalizeStatus(JSON.parse(raw));
  } catch {}
  return { status: DEFAULT_STATUS.id, updated_at: null };
}

function demoWrite(row) {
  try {
    localStorage.setItem(DEMO_STATUS_KEY, JSON.stringify(row));
  } catch {}
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: row }));
  demoChannel?.postMessage(row);
}

export function normalizeStatus(row) {
  const status = STATUSES.some((item) => item.id === row?.status)
    ? row.status
    : DEFAULT_STATUS.id;
  return {
    status,
    updated_at: row?.updated_at || null,
  };
}

export async function fetchStatus() {
  if (!supabase) return demoRead();

  const { data, error } = await supabase
    .from(TABLES.status)
    .select("status, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  return normalizeStatus(data);
}

export async function setStatus(statusId) {
  if (!STATUSES.some((item) => item.id === statusId)) {
    throw new Error("INVALID_STATUS");
  }

  const updated_at = new Date().toISOString();

  if (!supabase) {
    const row = { status: statusId, updated_at };
    demoWrite(row);
    return row;
  }

  const { data, error } = await supabase
    .from(TABLES.status)
    .upsert(
      { id: 1, status: statusId, updated_at },
      { onConflict: "id" },
    )
    .select("status, updated_at")
    .single();

  if (error) throw error;
  return normalizeStatus(data);
}

function subscribeStatus(onStatus, onConnection) {
  if (!supabase) {
    const onStorage = (event) => {
      if (event.key === DEMO_STATUS_KEY) onStatus(demoRead());
    };
    const onCustom = () => onStatus(demoRead());
    const onMessage = (event) => {
      if (event.data && event.data.status) onStatus(normalizeStatus(event.data));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(DEMO_EVENT, onCustom);
    demoChannel?.addEventListener("message", onMessage);
    onConnection?.("online");

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DEMO_EVENT, onCustom);
      demoChannel?.removeEventListener("message", onMessage);
    };
  }

  const channel = supabase
    .channel("roomset-status")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: TABLES.status,
        filter: "id=eq.1",
      },
      (payload) => {
        if (payload?.new) onStatus(normalizeStatus(payload.new));
      },
    )
    .subscribe((state) => {
      if (state === "SUBSCRIBED") onConnection?.("online");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        onConnection?.("offline");
      } else {
        onConnection?.("connecting");
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export function watchStatus({ onStatus, onConnection } = {}) {
  let active = true;

  const emit = (row) => {
    if (active) onStatus?.(normalizeStatus(row));
  };

  const load = async (markConnection = false) => {
    try {
      const row = await fetchStatus();
      if (!active) return;
      emit(row);
      if (markConnection) onConnection?.("online");
    } catch (error) {
      console.warn("[RoomSet] status load failed:", error);
      if (active) onConnection?.("offline");
    }
  };

  load(true);

  const unsubscribeRealtime = subscribeStatus(emit, (state) => {
    if (active) onConnection?.(state);
  });

  const poll = window.setInterval(() => {
    if (document.visibilityState === "visible") load(false);
  }, 60000);

  const onVisibility = () => {
    if (document.visibilityState === "visible") load(false);
  };
  const onOnline = () => load(true);
  const onOffline = () => onConnection?.("offline");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    active = false;
    unsubscribeRealtime?.();
    window.clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

export async function sendPing(message = null, type = "ping") {
  if (!supabase) {
    await new Promise((resolve) => setTimeout(resolve, 420));
    try {
      const list = JSON.parse(localStorage.getItem(DEMO_PING_KEY) || "[]");
      list.unshift({
        id: String(Date.now()),
        type,
        message,
        created_at: new Date().toISOString(),
      });
      localStorage.setItem(DEMO_PING_KEY, JSON.stringify(list.slice(0, 25)));
    } catch {}
    return { demo: true };
  }

  const { error } = await supabase
    .from(TABLES.notifications)
    .insert({ type, message });

  if (error) throw error;
  return { ok: true };
}

export async function saveDeviceToken(token, role = "admin") {
  if (!supabase || !token) return { demo: true };

  const device = {
    token,
    role,
    user_agent: (navigator.userAgent || "").slice(0, 300),
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLES.devices).insert(device);

  if (!error) return { ok: true, inserted: true };

  if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
    const { error: updateError } = await supabase
      .from(TABLES.devices)
      .update({
        role: device.role,
        user_agent: device.user_agent,
        last_seen_at: device.last_seen_at,
      })
      .eq("token", token);

    if (updateError) throw updateError;
    return { ok: true, updated: true };
  }

  throw error;
}

const relativeFormatter =
  typeof Intl !== "undefined" && Intl.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat("ar", { numeric: "auto" })
    : null;

const clockFormatter = new Intl.DateTimeFormat("ar", {
  hour: "2-digit",
  minute: "2-digit",
});

export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const diff = Math.max(0, Date.now() - then);
  if (diff < 45000) return "الآن";

  const minutes = Math.round(diff / 60000);
  if (minutes < 60) {
    return relativeFormatter
      ? relativeFormatter.format(-minutes, "minute")
      : `قبل ${minutes} دقيقة`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return relativeFormatter
      ? relativeFormatter.format(-hours, "hour")
      : `قبل ${hours} ساعة`;
  }

  const days = Math.round(hours / 24);
  return relativeFormatter
    ? relativeFormatter.format(-days, "day")
    : `قبل ${days} يوم`;
}

export function clockTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return clockFormatter.format(date);
}

let swRegistration = null;

export async function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (swRegistration) return swRegistration;

  try {
    swRegistration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });

    if (!swRegistration.active) {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);
    }

    return swRegistration;
  } catch (error) {
    console.warn("[RoomSet] service worker registration failed:", error);
    return null;
  }
}

export async function getServiceWorkerRegistration() {
  if (swRegistration) return swRegistration;
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
