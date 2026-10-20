# Perimeter — Distribution

What other people get when they install Perimeter, and what has to change before that happens.
Written 2026-10-20. Nothing here is built yet; packaging itself isn't set up.

---

## Who can see which code

Each of the three apps reaches users differently, and only one of them stays private.

| Part | Where it runs | Can users read the code? |
|---|---|---|
| API | A server (Render/Railway/Fly.io) | No. Users only see its responses. |
| Website | The user's browser | Yes, in the browser's dev tools. |
| Menu bar app | The user's Mac | Yes, with one command. |

**The menu bar app.** An Electron app is a copy of Chromium and Node plus our JavaScript. The
JavaScript is stored in `Perimeter.app/Contents/Resources/app.asar`, which is an archive like a zip.
It isn't encrypted: `npx asar extract app.asar out/` unpacks it. Minifying the esbuild bundle makes
it harder to read, but the code is still there. Every Electron app works this way (VS Code, Slack,
Discord).

**The website.** A browser has to download JavaScript to run it, so the code is always visible. A
Vite production build minifies it. If source maps are published too, people get the original
readable source.

**The API.** This is where business logic lives (sessions, breaks, notification decisions), so the
rules that matter are the ones users can't see or change. That's a second reason, besides having one
source of truth, for keeping logic out of the menu bar.

### What follows from that

- **No secrets in the menu bar app or the website.** An API key or token bundled into either one is
  effectively public. Secrets live on the API server only.
- **Assume the menu bar app can be modified.** Someone could patch it to always report `away`. That
  fits the bar the project already accepts (a deliberate, multi-step cheat is out of scope), and
  it's why the API decides what counts, not the client.
- **A public repo exposes everything anyway.** Packaging doesn't matter for code that's already on
  GitHub, and that includes the git history.

---

## The iPhone address and `.env`

**Today it's fine.** `apps/menu-bar/.env` is gitignored and only lives on the developer's Mac.
`.env.example` holds a placeholder.

**It stops working once the app is packaged.** The tray app reads `.env` from `app.getAppPath()`
(`apps/menu-bar/src/main.ts`). In a packaged app, that path is inside `app.asar`. That causes two
problems:

1. **The developer's address could ship to everyone.** `electron-builder` packs whatever is in the
   app folder. Don't assume it skips `.env` (not verified). If the file gets packed, every
   download contains the developer's phone address. Everyone's app would watch for that phone and
   read `device-absent` forever.
2. **Users can't supply their own.** Nobody will create a hidden file inside a `.app` bundle, and
   editing a signed app breaks its signature.

### Plan

- **Exclude `.env` from the package explicitly** (`"!.env"` in electron-builder's `files`). After
  the first build, check with `npx asar list app.asar`.
- **Store per-user settings outside the app**, in `app.getPath("userData")`, which is
  `~/Library/Application Support/Perimeter/`. This is the standard place for Mac app settings.
- **Ask on first launch.** List the paired devices from `system_profiler SPBluetoothDataType` and let
  the user pick their iPhone, so nobody has to find or type a Bluetooth address. Afterwards the app
  reads the saved choice.
- **Keep `.env` as a developer override**, so `pnpm dev` and `pnpm start` work as they do now.

The API address (`PERIMETER_API_URL`) has the same problem, but in reverse: a downloaded app should
point at the hosted API by default, not `localhost`.

---

## The address in git history

Before commit `5d8eebc`, the developer's real iPhone address was hard-coded as a default, and real
headphone addresses appeared in a test fixture and `ARCHITECTURE.md`. The current code uses
placeholders, but older commits still contain the real values, and the repo is public.

**Risk is low.** This is the phone's fixed identity address. Over the air, iPhones broadcast
rotating random addresses, so a stranger nearby can't use the identity address to track the phone.
It mostly just identifies the device.

**Removing it means rewriting history** (`git filter-repo`, then a force-push). That changes every
commit hash and breaks existing clones. For a value this low-sensitivity, the decision so far is to
leave it.
