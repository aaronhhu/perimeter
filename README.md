# Perimeter

A focus app that works by noticing where your phone is.

Your Mac listens for your iPhone over Bluetooth and measures how strong its signal is. Phone on the desk next to you means you're distracted. Phone put away in another room means you're focusing. The app tracks focus sessions, breaks, and a daily timeline from that.

There's no iPhone app to install. The iPhone already broadcasts Bluetooth signals all the time (for AirDrop, Handoff, and Find My), and the Mac just listens to how loud they are.

> **Status:** early development. It runs locally on one machine, for one user, and these instructions will change.

## Platform support

**macOS only.** The Bluetooth reading comes from `system_profiler`, a tool built into macOS, and the app lives in the macOS menu bar. Windows and Linux are not supported. The phone has to be an **iPhone**.

## Prerequisites

### Software

- **macOS**
- **Node.js 20+**
- **pnpm 10+** (`npm install -g pnpm`, or `corepack enable`). Use pnpm, not npm: the repo is a pnpm workspace.
- **Docker** (Docker Desktop or similar) to run Postgres locally

### Bluetooth setup (the important part)

The app only works if your Mac can already "see" your iPhone over Bluetooth. Before installing anything, check these:

1. **Bluetooth is on** on both the Mac and the iPhone. If either one turns it off, the app can't tell where the phone is (it shows *unknown* and asks if Bluetooth is off).
2. **The iPhone is paired with the Mac.** On the Mac, open System Settings → Bluetooth. Your iPhone should be listed under *My Devices*. If it isn't, keep the iPhone's Settings → Bluetooth screen open and click **Connect** next to the iPhone on the Mac, then accept the pairing code on both devices.
3. **The Mac is getting a signal from the phone.** Run this in Terminal with the phone nearby:

   ```sh
   system_profiler SPBluetoothDataType
   ```

   Find your iPhone in the output. It should have an **Address** line (something like `AA:BB:CC:DD:EE:FF`) and an **RSSI** line (a negative number like `-45`). If you see the RSSI, you're set. Write down the address; you'll need it below.

**Don't worry if the iPhone says "Not Connected" or "Connection Unsuccessful."** That's normal. iPhones refuse a full Bluetooth connection to a Mac, but the app doesn't need one. It only reads the signal strength the phone broadcasts.

> ⚠️ **Never "Forget This Device"** on either the iPhone or the Mac, even when iOS suggests it after a failed connection. The pairing is what lets the Mac recognize *your* phone. iPhones change their Bluetooth address about every 15 minutes, and the pairing is what links those changing addresses back to your phone. If you remove it, the app stops working.

## Running it locally

There are three parts, and each one runs in its own terminal:

| Part | Folder | What it does |
|---|---|---|
| Menu bar app | `apps/menu-bar` | Reads the phone's signal and decides whether it's present or away |
| API | `apps/api` | Stores sessions, breaks, and presence history in Postgres |
| Website | `apps/website` | Shows today's timeline (more features coming) |

### 1. Install dependencies

```sh
pnpm install
```

### 2. Start the database

```sh
docker compose up -d
```

This starts Postgres on port 5432 with user, password, and database all set to `perimeter`.

### 3. Set up and start the API

```sh
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` so it points at the Docker database:

```
DATABASE_URL=postgres://perimeter:perimeter@localhost:5432/perimeter
PORT=3000
```

Then create the tables, add the single local user, and start the server:

```sh
pnpm --filter @perimeter/api db:migrate
pnpm --filter @perimeter/api db:seed
pnpm --filter @perimeter/api dev
```

The API runs at http://localhost:3000.

### 4. Start the website

In a new terminal:

```sh
pnpm --filter @perimeter/website dev
```

Open http://localhost:5173.

### 5. Start the menu bar app

Tell it which phone is yours. Copy the example settings file:

```sh
cp apps/menu-bar/.env.example apps/menu-bar/.env
```

Edit `apps/menu-bar/.env` and replace the placeholder with the iPhone address from the Bluetooth check above:

```
PERIMETER_IPHONE_ADDRESS=AA:BB:CC:DD:EE:FF
```

`.env` is gitignored, so your address stays on your machine. The app won't start without it, and it tells you why. Then, in a new terminal:

```sh
pnpm --filter @perimeter/menu-bar start
```

An icon appears in the macOS menu bar. Allow notifications when macOS asks.

After launch it takes about 30 seconds to decide whether the phone is present or away, and every later change takes about 20 seconds. The delay is deliberate: the Bluetooth signal is noisy, and reacting to one bad reading would make the app flip back and forth.

## Configuration

Menu bar settings go in `apps/menu-bar/.env`. API settings go in `apps/api/.env`. A variable set in the shell works too.

| Variable | Used by | Default | What it's for |
|---|---|---|---|
| `PERIMETER_IPHONE_ADDRESS` | menu bar | (none, required) | Your iPhone's Bluetooth address |
| `PERIMETER_API_URL` | menu bar | `http://localhost:3000` | Where to send presence updates |
| `PERIMETER_WEBSITE_URL` | menu bar | `http://localhost:5173` | What the tray's website item opens |
| `PERIMETER_DEBUG` | menu bar CLI | off | Set to `1` to print every reading |
| `DATABASE_URL` | API | (none, required) | Postgres connection string |
| `PORT` | API | `3000` | API port |

### Distance thresholds

The thresholds for "present" and "away" are tuned for one room, one Mac, and one phone: below −65 counts as away, above −55 counts as present. Your desk and walls will shift those numbers. If the app gets your phone's position wrong, run the CLI below, note the readings at your desk and in another room, and adjust `DEFAULT_CONFIG` in `apps/menu-bar/src/filter.ts`. A calibration flow is planned.

## Useful commands

```sh
# Run the signal reader in the terminal, with no menu bar icon
PERIMETER_DEBUG=1 pnpm --filter @perimeter/menu-bar dev

# Tests and type checks
pnpm --filter @perimeter/menu-bar test
pnpm --filter @perimeter/website test
pnpm -r typecheck
```

## Troubleshooting

- **Menu bar app opens as plain Node or nothing appears:** terminals inside VS Code and Claude Code set `ELECTRON_RUN_AS_NODE=1`. `pnpm start` clears it, so launch through `pnpm start` rather than calling `electron` directly.
- **No notifications:** `pnpm install` re-signs the Electron binary so macOS will allow its notifications. If you skipped the install scripts, run `pnpm install` again.
- **"PERIMETER_IPHONE_ADDRESS is missing":** `apps/menu-bar/.env` doesn't exist, or the address in it isn't six pairs of letters/digits like `AA:BB:CC:DD:EE:FF`. See step 5.
- **Phone never detected (`device-absent`):** the address is wrong, or the pairing is gone. Re-check `system_profiler SPBluetoothDataType` and make sure the iPhone is still listed under *My Devices*.
- **State stuck on unknown:** Bluetooth is probably off on the phone, or it's in a dead spot. Turn Bluetooth on and bring the phone close to the Mac for a moment.

## More detail

- [`ARCHITECTURE.md`](ARCHITECTURE.md): how it works and why it was designed this way
- [`docs/findings.md`](docs/findings.md): dated test results behind the tuning
