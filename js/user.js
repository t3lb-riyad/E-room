import {
  APP_SETTINGS,
  DEFAULT_STATUS,
  STATUSES,
  clockTime,
  initServiceWorker,
  isSupabaseConfigured,
  sendPing,
  statusById,
  timeAgo,
  watchStatus,
} from "./core.js";
import {
  setConnection,
  setLoading,
  statusButton,
  toast,
} from "./ui.js";

/* =========================================================================
   RoomSet — public visitor view (user.html)
   ========================================================================= */

const COOLDOWN_KEY = "roomset:cooldown-until";

const els = {
  hero: document.getElementById("hero-card"),
  heroTitle: document.getElementById("hero-title"),
  heroSub: document.getElementById("hero-sub"),
  heroTime: document.getElementById("hero-time"),
  heroNotify: document.getElementById("hero-notify"),
  otherList: document.getElementById("other-list"),
  hint: document.getElementById("user-hint"),
  fab: document.getElementById("fab"),
  fabLabel: document.getElementById("fab-label"),
  conn: document.getElementById("conn-pill"),
  demoBanner: document.getElementById("demo-banner"),
};

const state = {
  row: null,
  current: null,
  ready: false,
};

let cooldownUntil = 0;
try {
  cooldownUntil = Number(localStorage.getItem(COOLDOWN_KEY)) || 0;
} catch {
  cooldownUntil = 0;
}

let sending = false;

boot();

function boot() {
  setLoading(true);
  initServiceWorker();

  if (!isSupabaseConfigured) {
    els.demoBanner.hidden = false;
  }

  watchStatus({
    onStatus: render,
    onConnection: (connection) => setConnection(els.conn, connection),
  });

  els.fab.addEventListener("click", handlePing);

  // Offline / blocked Supabase fallback: show the default state instead of
  // leaving the hero on its loading text forever.
  window.setTimeout(() => {
    if (state.ready) return;
    render({ status: DEFAULT_STATUS.id, updated_at: null });
    toast("تعذّر الاتصال بالخادم — تُعرض الحالة الافتراضية.", {
      type: "warning",
      duration: 5200,
    });
  }, 5000);

  window.setInterval(() => {
    if (state.row?.updated_at) {
      els.heroTime.textContent = `آخر تحديث ${timeAgo(state.row.updated_at)} · ${clockTime(
        state.row.updated_at,
      )}`;
    }
    tickCooldown();
  }, 1000);

  tickCooldown();
}

function render(row) {
  if (!row) return;

  const active = statusById(row.status);
  state.row = row;
  state.current = active;

  els.hero.style.setProperty("--led", active.led);
  els.hero.classList.toggle("is-offline", !active.canNotify);
  els.heroTitle.textContent = active.label;
  els.heroSub.textContent = active.description;
  els.heroNotify.textContent = active.canNotify
    ? "يمكنه استقبال التنبيهات"
    : "لن يستقبل التنبيهات الآن";
  els.heroNotify.dataset.state = active.canNotify ? "yes" : "no";

  els.heroTime.textContent = row.updated_at
    ? `آخر تحديث ${timeAgo(row.updated_at)} · ${clockTime(row.updated_at)}`
    : "لم تُضبط الحالة بعد";

  els.otherList.replaceChildren(
    ...STATUSES.filter((item) => item.id !== active.id).map((item) =>
      statusButton(item, { dim: true }),
    ),
  );

  els.hint.textContent = active.canNotify
    ? "اضغط على الجرس لإرسال تنبيه فوري إلى المضيف."
    : "المضيف خارج بدون هاتف — قد لا يصل التنبيه.";

  document.title = `${active.label} — حالة الغرفة`;

  if (!state.ready) {
    state.ready = true;
    setLoading(false);
  }
}

/* -------------------------------------------------------------------------
   Sending a ping
   ------------------------------------------------------------------------- */

async function handlePing() {
  if (sending) return;

  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) {
    toast(`انتظر ${Math.ceil(remaining / 1000)} ثانية قبل إرسال تنبيه آخر.`, {
      type: "warning",
    });
    return;
  }

  sending = true;
  els.fab.classList.remove("is-sending");
  void els.fab.offsetWidth; // restart the bell animation
  els.fab.classList.add("is-sending");
  navigator.vibrate?.(14);
  tickCooldown();

  try {
    await sendPing("أحدهم يطلب انتباهك الآن.");

    cooldownUntil = Date.now() + APP_SETTINGS.pingCooldownMs;
    try {
      localStorage.setItem(COOLDOWN_KEY, String(cooldownUntil));
    } catch {
      /* ignore */
    }

    toast("تم إرسال التنبيه بنجاح ✓", { type: "success" });

    if (!state.current?.canNotify) {
      window.setTimeout(() => {
        toast("المضيف خارج بدون هاتف — قد لا يرى التنبيه الآن.", {
          type: "warning",
          duration: 5200,
        });
      }, 1900);
    }
  } catch (error) {
    const message = String(error?.message || "");
    console.error("[RoomSet] ping failed:", error);

    if (message.includes("RATE_LIMITED")) {
      cooldownUntil = Date.now() + 15000;
      toast("تم إرسال تنبيه مؤخراً. جرّب بعد قليل.", { type: "warning" });
    } else {
      toast("تعذّر إرسال التنبيه. تحقّق من اتصالك وحاول مجدداً.", {
        type: "error",
      });
    }
  } finally {
    sending = false;
    els.fab.classList.remove("is-sending");
    tickCooldown();
  }
}

function tickCooldown() {
  if (!els.fab) return;

  if (sending) {
    els.fab.disabled = true;
    els.fab.classList.remove("is-cooldown");
    els.fabLabel.textContent = "جارٍ الإرسال…";
    return;
  }

  const remaining = cooldownUntil - Date.now();

  if (remaining > 0) {
    els.fab.disabled = true;
    els.fab.classList.add("is-cooldown");
    els.fabLabel.textContent = `انتظر ${Math.ceil(remaining / 1000)} ث`;
    return;
  }

  els.fab.disabled = false;
  els.fab.classList.remove("is-cooldown");
  els.fabLabel.textContent = "إرسال تنبيه";
}
