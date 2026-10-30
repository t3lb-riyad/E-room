import { STATUSES, statusById } from "./core.js";

const CHECK_ICON = `
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
       stroke="currentColor" stroke-width="2.8" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.2 4.2L19 7"/>
  </svg>`;

export function statusButton(status, options = {}) {
  const { active = false, dim = false, interactive = false } = options;
  const el = document.createElement(interactive ? "button" : "div");

  if (interactive) {
    el.type = "button";
    el.setAttribute("role", "radio");
    el.setAttribute("aria-checked", active ? "true" : "false");
    el.dataset.status = status.id;
  }

  el.className = [
    "status-btn",
    active ? "is-active" : "",
    dim ? "is-dim" : "",
  ]
    .filter(Boolean)
    .join(" ");
  el.style.setProperty("--led", status.led);

  el.innerHTML = `
    <span class="led" aria-hidden="true"></span>
    <span class="status-copy">
      <span class="status-title">${status.label}</span>
      <span class="status-sub">${status.description}</span>
    </span>
    <span class="status-end" aria-hidden="true">${active ? CHECK_ICON : ""}</span>
  `;

  return el;
}

export function buildStatusList(container, { onSelect } = {}) {
  container.replaceChildren(
    ...STATUSES.map((status) => {
      const button = statusButton(status, { interactive: true });
      button.addEventListener("click", () => onSelect?.(status, button));
      return button;
    }),
  );
}

export function syncStatusButtons(container, activeId) {
  container.querySelectorAll(".status-btn").forEach((button) => {
    const active = button.dataset.status === activeId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
    const end = button.querySelector(".status-end");
    if (end) end.innerHTML = active ? CHECK_ICON : "";
  });
}

const CONNECTION_LABELS = {
  connecting: "جارٍ الاتصال",
  online: "متصل",
  offline: "غير متصل",
};

export function setConnection(el, state) {
  if (!el) return;
  const next = CONNECTION_LABELS[state] ? state : "connecting";
  el.dataset.state = next;
  const label = el.querySelector("[data-conn-label]");
  if (label) label.textContent = CONNECTION_LABELS[next];
}

let toastTimer = null;

export function toast(message, { type = "info", duration = 3600 } = {}) {
  const el = document.getElementById("toast");
  if (!el) return;

  window.clearTimeout(toastTimer);
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    el.classList.remove("is-visible");
  }, duration);
}

export function setLoading(isLoading) {
  document.body.classList.toggle("is-loading", isLoading);
  document.body.dataset.ready = isLoading ? "false" : "true";
}

export function renderStatusSummary(container, statusId) {
  if (!container) return;
  const status = statusById(statusId);
  container.textContent = status.label;
  container.style.setProperty("--led", status.led);
}

export function formatUpdatedAt(iso) {
  if (!iso) return "لم يُحدَّد بعد";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "لم يُحدَّد بعد";
  return date.toLocaleString("ar", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}
