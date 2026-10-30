# حالة الغرفة · RoomSet

A mobile-first PWA with two screens:

- **`index.html`** — the admin panel. Pick one of four statuses; the LED lights up and the row is saved to Supabase instantly.
- **`user.html`** — the public view. Shows the admin's live status and a liquid-glass notification FAB that pings the admin through Supabase + FCM.

Built with vanilla HTML/CSS/JS, Supabase (Postgres + Realtime), and Firebase Cloud Messaging.

---

## 1. File map

```
room-set/
├── index.html                  Admin panel
├── user.html                   Public visitor view
├── offline.html                Offline fallback
├── manifest.webmanifest        PWA manifest (admin)
├── manifest-user.webmanifest   PWA manifest (visitors)
├── sw.js                       App-shell cache + FCM background handler
├── css/
│   └── styles.css              All styling (Cairo, RTL, mobile-first)
├── js/
│   ├── config.js               ← PUT YOUR CREDENTIALS HERE
│   ├── core.js                 Supabase client, realtime, demo fallback
│   ├── ui.js                   Shared DOM helpers + toast
│   ├── admin.js                Admin panel logic
│   ├── user.js                 Visitor view logic
│   └── push.js                 FCM token registration
├── icons/                      App icons (icon-512.png is the source artwork)
├── tools/
│   └── make-icons.ps1          Regenerates every icon from icons/icon-512.png
└── supabase/
    ├── schema.sql              Tables, RLS, Realtime, push trigger
    └── functions/
        └── send-push/
            └── index.ts        FCM HTTP v1 Edge Function
```

---

## 2. Quick start (UI preview)

The UI runs in **demo mode** until credentials are added: status is stored in `localStorage` and synced between tabs, and the FAB shows a local success toast.

Serve the folder over HTTP (service workers do not run from `file://`):

```bash
# any static server works
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080/index.html` and `http://localhost:8080/user.html`.

> For push notifications and PWA installation you need **HTTPS** (localhost is the only exception).

---

## 3. Supabase setup

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor** and run the whole of [`supabase/schema.sql`](supabase/schema.sql).
3. Go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key
4. Paste both into `js/config.js` under `supabase`.

That is enough for the live status sync. The schema also creates:

| Table | Purpose |
| --- | --- |
| `admin_status` | Single row (`id = 1`) holding the current status |
| `devices` | FCM registration tokens (`role = 'admin'`) |
| `notifications` | One row per visitor ping; a trigger calls the push function |

Realtime is enabled on `admin_status` automatically.

### Test the realtime sync

Open the admin page in one tab and the visitor page in another. Change the status — the visitor page should update in under a second.

---

## 4. Firebase / FCM setup

1. Create a project at <https://console.firebase.google.com>.
2. **Add app → Web**, copy the config object into `js/config.js` under `firebase`.
3. **Cloud Messaging → Web Push certificates → Generate key pair** and paste the public key into `vapidKey`.
4. **Project settings → Service accounts → Generate new private key**. Keep this JSON file private. You will use `project_id`, `client_email`, and `private_key` for the Edge Function.

The app requests notification permission from the **“تفعيل الإشعارات”** button on the admin page. After permission is granted it calls `getToken()` and inserts the result into `public.devices`:

```js
{ token, role: "admin", user_agent, last_seen_at }
```

If the same browser registers again, the existing row is refreshed instead of duplicated.

> `vapidKey` is required. If it is missing or still a placeholder, the admin panel shows **“مفتاح VAPID ناقص”** and never calls `getToken()`, so no row will appear in `devices`.

> On iPhone/iPad, web push works only after the PWA is added to the Home Screen (iOS 16.4+).

---

## 5. Push pipeline (Supabase Edge Function)

```
visitor taps FAB
  → INSERT into public.notifications
  → Postgres trigger notify_admin_push()
  → pg_net POST → Edge Function send-push
  → FCM HTTP v1 → admin device
```

### 5.1 Deploy the function

```bash
npm i -g supabase
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>

supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` is required because the database trigger calls the function without a user JWT. The function authenticates the request with `WEBHOOK_SECRET` instead.

### 5.2 Set function secrets

Generate a long random secret (for example `openssl rand -hex 32`) and use it in both places below.

```bash
supabase secrets set \
  FIREBASE_PROJECT_ID="<project_id>" \
  FIREBASE_CLIENT_EMAIL="<client_email>" \
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  WEBHOOK_SECRET="<long-random-string>" \
  SITE_URL="https://your-site.example.com"
```

- `FIREBASE_PRIVATE_KEY` must keep its `\n` escapes (the function converts them to newlines).
- `SITE_URL` is used for the notification icon and the click-through link. No trailing slash.

On **Windows PowerShell**, run the same command on one line (PowerShell does not use `\` for line continuation):

```powershell
supabase secrets set FIREBASE_PROJECT_ID="<project_id>" FIREBASE_CLIENT_EMAIL="<client_email>" FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" WEBHOOK_SECRET="<long-random-string>" SITE_URL="https://your-site.example.com"
```

Use double quotes so PowerShell keeps the `\n` sequences literal. If you prefer multiple lines, end each line with a backtick `` ` `` instead of `\`.

### 5.3 Store the trigger secrets in Vault

In the Supabase SQL Editor:

```sql
select vault.create_secret(
  'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/send-push',
  'push_function_url'
);

select vault.create_secret('<the same WEBHOOK_SECRET>', 'push_webhook_secret');
```

If a secret already exists, update it with `vault.update_secret(id, value)` instead.

### 5.4 Verify

1. Open the admin page, tap **تفعيل الإشعارات**, allow the prompt.
2. Confirm a row appeared in `public.devices`.
3. Wait at least 8 seconds (server throttle), then tap the FAB on the visitor page.
4. Check **Edge Functions → send-push → Logs** in the Supabase dashboard.

You can also test the trigger directly:

```sql
insert into public.notifications (message) values ('اختبار');
```

Inspect `net._http_response` if you need to debug the trigger's HTTP call.

---

## 6. `js/config.js` reference

```js
var APP_CONFIG = {
  supabase: {
    url: "https://YOUR-PROJECT.supabase.co",
    anonKey: "YOUR_SUPABASE_ANON_KEY",
  },
  firebase: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR-PROJECT.firebaseapp.com",
    projectId: "YOUR-PROJECT",
    storageBucket: "YOUR-PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID",
    vapidKey: "YOUR_WEB_PUSH_VAPID_KEY",
  },
  app: {
    pingCooldownMs: 20000,
    defaultStatus: "in_room",
  },
};
```

`config.js` is deliberately a classic script: the service worker loads it with `importScripts()` so there is a single source of truth.

---

## 7. Status values

| DB value | Arabic label | LED | Notifications |
| --- | --- | --- | --- |
| `in_room` | في الغرفة | Green | Reachable |
| `out_no_phone` | خارج بدون هاتف | Red | Not reachable |
| `out_with_phone` | خارج معي الهاتف | Blue | Reachable |
| `university` | في الجامعة | White | Reachable |

Add or rename statuses in `js/core.js` (`STATUSES`) **and** update the check constraint in `supabase/schema.sql`. Keep the IDs in sync.

---

## 8. Deploying

Deploy the folder to any static host with HTTPS — Netlify, Vercel, Cloudflare Pages, GitHub Pages, Firebase Hosting, etc.

Recommended headers:

```text
/sw.js                 Cache-Control: no-cache
/js/config.js          Cache-Control: no-cache
/manifest*.webmanifest Content-Type: application/manifest+json
```

After changing `js/config.js`, `sw.js`, or any cached asset, bump `CACHE_VERSION` in `sw.js` so clients pick up the new version. `js/config.js` is fetched network-first (cache fallback only when offline), so credential changes apply on the next reload even before the cache version changes.

### PWA install

- **Android/Chrome:** menu → “Install app” (or the install link on the admin page).
- **iOS/Safari:** Share → “Add to Home Screen”. Push works only in the installed app.

---

## 9. Security hardening (read before a public launch)

The SQL policies are intentionally simple so the app works without accounts. They allow anyone with the public `anon` key to:

- read/update `admin_status`
- register a device token
- insert a notification (rate-limited to one per 8 seconds)

For a public deployment, switch to Supabase Auth:

1. Enable email/OTP or anonymous sign-in.
2. Replace the `admin_status` insert/update policies with a check against the admin user's UID.
3. Restrict `notifications` inserts to authenticated users (optionally with CAPTCHA).
4. Keep `devices` readable only by the service role.
5. Never ship the Firebase service-account private key to the browser.

The Edge Function already verifies `x-webhook-secret` and uses the service-role key only server-side.

---

## 10. Troubleshooting

**Status does not update live**
- Check that `admin_status` is in the `supabase_realtime` publication.
- Confirm the `anon` key is correct and the SELECT policy exists.
- The app also polls every 60 seconds and on tab focus, so a dropped WebSocket is not fatal.

**No push notification**
- Permission must be `granted`; check browser site settings.
- Confirm a token exists in `devices` with `role = 'admin'`.
- Verify `vapidKey` is the **Web Push certificate** public key, not an API key.
- On iOS, install the PWA to the Home Screen first.
- Check `supabase functions logs send-push` for FCM errors.
- Ensure the deployed function has `--no-verify-jwt` and the Vault URL is correct.
- FCM tokens are removed automatically when Google reports them as unregistered.

**Notifications are enabled but `devices` is empty**
- Add the real `vapidKey` in `js/config.js` (Firebase → Project settings → Cloud Messaging → Web Push certificates). Without it the app intentionally does not call `getToken()`.
- Reload once after editing `js/config.js`. Cache `roomset-v1.2.0` fetches `config.js` network-first, but an already-installed worker may need a reload to update.
- Open DevTools → Console and look for `[RoomSet] FCM token acquired` followed by `[RoomSet] FCM token saved to public.devices`.
- If you see a row-level-security error, re-run the `devices` insert policy from `supabase/schema.sql`.
- Verify from the Supabase Table Editor (the anon client intentionally has no SELECT policy on `devices`):

```sql
select id, role, left(token, 12) as token_prefix, user_agent,
       created_at, last_seen_at
from public.devices
order by created_at desc;
```

**`send-push` returns 500: “Unrecognized algorithm name”**
- This comes from the Google OAuth JWT signing step. The JWT header correctly uses `alg: "RS256"`, but Web Crypto's `importKey()` / `sign()` must use `RSASSA-PKCS1-v1_5` with `hash: "SHA-256"`.
- The function in this repo is already fixed. If you deployed an older copy, redeploy:
  ```bash
  supabase functions deploy send-push --no-verify-jwt
  ```

**`send-push` logs 400: “Invalid value at 'message.data[N].value' (TYPE_STRING)”**
- FCM HTTP v1 requires **every** value in `message.data` to be a JSON string. A numeric value (for example a `bigint` notification id coming from the webhook `record`) is rejected.
- The function now coerces all `data` values with `String()` before sending, so `notificationId` works whether the table uses `uuid` or `bigint`.
- Redeploy after pulling the fix:
  ```bash
  supabase functions deploy send-push --no-verify-jwt
  ```
- The failure log now includes the exact offending field:
  ```
  [send-push] delivery failed { status: 400, field: 'message.data[3].value', ... }
  ```

**“RATE_LIMITED” toast**
- The Postgres trigger allows one ping every 8 seconds. The client cooldown is 20 seconds by default; adjust both if needed.

**Design/config changes are not visible**
- The service worker caches the app shell. Bump `CACHE_VERSION` in `sw.js`, or use DevTools → Application → Service Workers → Update / Clear storage.

**Icons look wrong on Android**
- `icon-maskable-512.png` has the safe-zone padding. Regenerate with `tools/make-icons.ps1` if you change the artwork.

**Changing the app logo**
- `icons/icon-512.png` is the single source of truth. Replace it, then run `tools/make-icons.ps1`. It derives `icon-192.png`, `icon-maskable-512.png` (scaled to 80% on white), `apple-touch-icon.png` (180×180) and `favicon-32.png`. Then bump `CACHE_VERSION` in `sw.js` and the `?v=` query on `js/config.js` in both HTML pages.

---

## 11. Commands cheat sheet

```bash
# local preview
npx serve .

# database schema: paste supabase/schema.sql into the Supabase SQL editor
# (or move it into supabase/migrations and run `supabase db push`)

# deploy the push function
supabase functions deploy send-push --no-verify-jwt

# function logs
supabase functions logs send-push

# regenerate icons (Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-icons.ps1
```
