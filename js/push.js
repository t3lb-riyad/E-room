import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

import {
  getServiceWorkerRegistration,
  hasVapidKey,
  initServiceWorker,
  isFirebaseAppConfigured,
  saveDeviceToken,
} from "./core.js";

let messaging = null;
let listeners = { onForeground: null, onState: null };
let currentState = "idle";
let registrationPromise = null;

function setState(state, detail = null) {
  currentState = state;
  listeners.onState?.(state, detail);
}

function firebaseConfig() {
  return self.APP_CONFIG?.firebase || {};
}

function ensureMessaging() {
  if (messaging) return messaging;
  if (!isFirebaseAppConfigured) throw new Error("FIREBASE_NOT_CONFIGURED");

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig());
  messaging = getMessaging(app);

  onMessage(messaging, (payload) => {
    listeners.onForeground?.(payload);
  });

  return messaging;
}

async function registerToken() {
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    if (!hasVapidKey) throw new Error("MISSING_VAPID_KEY");

    const sw =
      (await initServiceWorker()) || (await getServiceWorkerRegistration());
    if (!sw) throw new Error("NO_SERVICE_WORKER");

    const token = await getToken(ensureMessaging(), {
      vapidKey: firebaseConfig().vapidKey,
      serviceWorkerRegistration: sw,
    });

    if (!token) throw new Error("NO_FCM_TOKEN");
    console.info("[RoomSet] FCM token acquired:", `${token.slice(0, 12)}…`);

    const saved = await saveDeviceToken(token, "admin");
    if (saved?.demo) throw new Error("SUPABASE_NOT_CONFIGURED");

    console.info("[RoomSet] FCM token saved to public.devices.");
    return token;
  })();

  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

export async function initPush(options = {}) {
  listeners = { ...listeners, ...options };

  if (!isFirebaseAppConfigured) {
    setState("unconfigured");
    return { enable: async () => false, getState: () => currentState };
  }

  if (!hasVapidKey) {
    setState("vapid");
    return { enable: async () => false, getState: () => currentState };
  }

  const supported =
    "serviceWorker" in navigator &&
    "Notification" in window &&
    (await isSupported().catch(() => false));

  if (!supported) {
    setState("unsupported");
    return { enable: async () => false, getState: () => currentState };
  }

  if (Notification.permission === "denied") {
    setState("denied");
    return { enable: async () => false, getState: () => currentState };
  }

  if (Notification.permission === "granted") {
    registerToken()
      .then(() => setState("granted"))
      .catch((error) => {
        console.warn("[RoomSet] FCM registration failed:", error);
        setState("error", error);
      });
  } else {
    setState("default");
  }

  const enable = async () => {
    if (!supported) return false;

    if (Notification.permission === "denied") {
      setState("denied");
      return false;
    }

    setState("requesting");

    let permission = Notification.permission;
    if (permission !== "granted") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      setState(permission === "denied" ? "denied" : "default");
      return false;
    }

    try {
      await registerToken();
      setState("granted");
      return true;
    } catch (error) {
      console.warn("[RoomSet] FCM registration failed:", error);
      setState("error", error);
      return false;
    }
  };

  return { enable, getState: () => currentState };
}
