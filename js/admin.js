import {
  initServiceWorker,
  isSupabaseConfigured,
  setStatus,
  timeAgo,
  watchStatus,
} from "./core.js";
import {
  buildStatusList,
  setConnection,
  setLoading,
  syncStatusButtons,
  toast,
} from "./ui.js";
import { initPush } from "./push.js";

const els = {
  list: document.getElementById("status-list"),
  conn: document.getElementById("conn-pill"),
  lastUpdated: document.getElementById("last-updated"),
  pushBtn: document.getElementById("push-btn"),
  pushLabel: document.getElementById("push-label"),
  pushNote: document.getElementById("push-note"),
  installBtn: document.getElementById("install-btn"),
  demoBanner: document.getElementById("demo-banner"),
};

const state = {
  current: null,
  pending: null,
  busy: false,
  ready: false,
  push: null,
  pushDetail: null,
};

const PUSH_UI = {
  idle: {
    label: "تفعيل الإشعارات",
    disabled: true,
    note: "جارٍ التحقق من حالة الإشعارات…",
  },
  requesting: {
    label: "جارٍ التفعيل…",
    disabled: true,
    note: "اسمح بالإشعارات من النافذة التي ستظهر.",
  },
  granted: {
    label: "الإشعارات مفعّلة",
    disabled: true,
    on: true,
    note: "",
  },
  default: {
    label: "تفعيل الإشعارات",
    disabled: false,
    note: "فعّل الإشعارات ليعرف هذا الجهاز عندما ينبّهك أحد.",
  },
  denied: {
    label: "الإشعارات محظورة",
    disabled: true,
    note: "اسمح بالإشعارات لهذا الموقع من إعدادات المتصفح، ثم أعد تحميل الصفحة.",
  },
  unsupported: {
    label: "الإشعارات غير مدعومة",
    disabled: true,
    note: "افتح الصفحة عبر HTTPS أو ثبّت التطبيق على الشاشة الرئيسية.",
  },
  unconfigured: {
    label: "أضف إعدادات Firebase",
    disabled: true,
    note: "أكمل مفاتيح Firebase في js/config.js لتفعيل الإشعارات.",
  },
  vapid: {
    label: "مفتاح VAPID ناقص",
    disabled: true,
    note: "ألصق مفتاح Web Push من Firebase في js/config.js ثم أعد تحميل الصفحة.",
  },
  error: {
    label: "إعادة محاولة التفعيل",
    disabled: false,
    note: "تعذّر تسجيل الجهاز. تحقّق من إعدادات FCM وحاول مجدداً.",
  },
};

boot();

async function boot() {
  setLoading(true);
  initServiceWorker();

  if (!isSupabaseConfigured) {
    els.demoBanner.hidden = false;
  }

  buildStatusList(els.list, { onSelect: handleSelect });

  watchStatus({
    onStatus: applyStatus,
    onConnection: (connection) => setConnection(els.conn, connection),
  });

  setupPush();
  setupInstall();

  window.setTimeout(() => {
    if (state.ready) return;
    state.ready = true;
    setLoading(false);
    toast("تعذّر تحميل الحالة الحالية. يمكنك اختيار حالتك الآن.", {
      type: "warning",
      duration: 5200,
    });
  }, 5000);

  window.setInterval(() => {
    if (state.current?.updated_at) {
      els.lastUpdated.textContent = timeAgo(state.current.updated_at);
    }
  }, 30000);
}

function applyStatus(row) {
  if (!row) return;

  if (state.pending && row.status !== state.pending) return;

  state.current = row;
  syncStatusButtons(els.list, row.status);

  if (els.lastUpdated) {
    els.lastUpdated.textContent = row.updated_at
      ? `آخر تحديث ${timeAgo(row.updated_at)}`
      : "لم يُحدَّد بعد";
  }

  if (!state.ready) {
    state.ready = true;
    setLoading(false);
  }
}

async function handleSelect(status) {
  if (state.busy) return;
  if (state.current?.status === status.id) return;

  const previous = state.current;
  state.busy = true;
  state.pending = status.id;

  applyStatus({
    status: status.id,
    updated_at: new Date().toISOString(),
  });

  navigator.vibrate?.(12);

  try {
    const saved = await setStatus(status.id);
    state.pending = null;
    applyStatus(saved);
    toast(`تم تحديث الحالة إلى «${status.label}»`, { type: "success" });
  } catch (error) {
    console.error("[RoomSet] status update failed:", error);
    state.pending = null;
    if (previous) {
      applyStatus(previous);
    } else {
      state.current = null;
      syncStatusButtons(els.list, null);
    }
    toast("تعذّر حفظ الحالة. تحقّق من اتصالك وحاول مجدداً.", {
      type: "error",
      duration: 5000,
    });
  } finally {
    state.busy = false;
  }
}

async function setupPush() {
  if (!els.pushBtn) return;

  state.push = await initPush({
    onForeground: (payload) => {
      const title = payload?.notification?.title || "تنبيه جديد";
      const body =
        payload?.notification?.body || "أحدهم يريد التواصل معك الآن.";
      toast(`${title} — ${body}`, { type: "info", duration: 6000 });
      navigator.vibrate?.([80, 50, 80]);
    },
    onState: (pushState, detail) => {
      state.pushDetail = detail;
      updatePushUI(pushState, detail);
    },
  });

  els.pushBtn.addEventListener("click", async () => {
    if (!state.push) return;
    const ok = await state.push.enable();
    const pushState = state.push.getState();

    if (ok) {
      toast("تم تفعيل الإشعارات وحفظ هذا الجهاز ✓", { type: "success" });
    } else if (pushState === "denied") {
      toast("الإشعارات محظورة من إعدادات المتصفح.", { type: "error" });
    } else if (pushState === "error") {
      toast(pushErrorMessage(state.pushDetail), {
        type: "error",
        duration: 6500,
      });
    }
  });
}

function pushErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");

  if (code.includes("MISSING_VAPID_KEY") || message.includes("MISSING_VAPID_KEY")) {
    return "مفتاح VAPID غير موجود. ألصقه في js/config.js ثم أعد تحميل الصفحة.";
  }
  if (message.includes("NO_SERVICE_WORKER")) {
    return "تعذّر تشغيل service worker. افتح الموقع عبر HTTPS وأعد المحاولة.";
  }
  if (message.includes("NO_FCM_TOKEN")) {
    return "لم يُرجع Firebase رمزاً للجهاز. تحقّق من إعدادات FCM وVAPID.";
  }
  if (message.includes("SUPABASE_NOT_CONFIGURED")) {
    return "Supabase غير مهيأ، لذلك لا يمكن حفظ رمز الجهاز.";
  }
  if (/row-level security|permission denied/i.test(message)) {
    return "قاعدة البيانات رفضت حفظ الجهاز. راجع سياسات RLS لجدول devices.";
  }
  if (message.includes("FIREBASE_NOT_CONFIGURED")) {
    return "إعدادات Firebase غير مكتملة في js/config.js.";
  }

  return message
    ? `تعذّر تسجيل الجهاز: ${message.slice(0, 140)}`
    : "تعذّر تسجيل الجهاز. تحقّق من إعدادات FCM وحاول مجدداً.";
}

function updatePushUI(pushState, detail) {
  const ui = PUSH_UI[pushState] || PUSH_UI.idle;

  if (els.pushLabel) els.pushLabel.textContent = ui.label;
  if (els.pushBtn) {
    els.pushBtn.disabled = Boolean(ui.disabled);
    els.pushBtn.classList.toggle("is-on", Boolean(ui.on));
  }
  if (els.pushNote) {
    els.pushNote.textContent =
      pushState === "error" ? pushErrorMessage(detail) : ui.note;
  }
}

function setupInstall() {
  if (!els.installBtn) return;
  if (window.matchMedia("(display-mode: standalone)").matches) return;

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installBtn.hidden = true;
    if (outcome === "accepted") {
      toast("تم تثبيت التطبيق على جهازك", { type: "success" });
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    els.installBtn.hidden = true;
    toast("تم تثبيت التطبيق على جهازك", { type: "success" });
  });
}
