import { app, dialog, Menu, Notification, Tray, nativeImage, powerMonitor, shell } from "electron";
import { join } from "node:path";
import {
  DEFAULT_MONITOR_CONFIG,
  startMonitor,
  type MonitorHandle,
  type MonitorState,
  type PresenceEvent,
  type ReportedPresence,
} from "./monitor";
import { normalizeAddress, type DeviceMatcher } from "./sampler";
import { addressFromEnv, invalidEnvAddress, loadEnvFile } from "./env";
import { BLUETOOTH_SETTINGS, pickIphone } from "./pickerWindow";
import { readSettings, saveSettings } from "./settings";
import { sendPresenceEvent, startHeartbeat } from "./api";
import { nudgeFor, STARTING, iconName, tooltip, viewOf, type StatusView } from "./presentation";
import { trayMenu } from "./tray";

// From the app's folder, not the cwd: a login-item launch doesn't start in apps/menu-bar.
loadEnvFile(join(app.getAppPath(), ".env"));

// A developer override. Without it the phone is the one picked in the app and saved per user.
const envAddress = addressFromEnv();

// TODO: the architecture wants a short-lived token on this URL so opening settings doesn't mean
// logging in again. Nothing to sign with yet — apps/api has no auth.
const websiteUrl = process.env["PERIMETER_WEBSITE_URL"] ?? "http://localhost:5173";
const apiUrl = process.env["PERIMETER_API_URL"] ?? "http://localhost:3000";

/** Local, not UTC: these logs get read next to a wall clock. */
const stamp = () => new Date().toTimeString().slice(0, 8);

const config = DEFAULT_MONITOR_CONFIG;

let previousFill = 0;

/**
 * Why the first ~25s produce readings but no verdict: the filter refuses to judge a partial window.
 * Counts the window *after* this sample joined it, so the sample that fills it prints "5/5" rather
 * than going silent — the changeover is the one line here worth seeing. Silent from then on, and it
 * starts over if a dropout or a wake clears the window.
 */
function filling({ filter }: MonitorState): string {
  const { windowSize } = config.filter;
  const filled = filter.samples.length;
  const justFilled = previousFill < windowSize && filled >= windowSize;
  previousFill = filled;

  if (filled < windowSize) return `  (window ${filled}/${windowSize})`;
  return justFilled ? `  (window ${windowSize}/${windowSize} — filter live)` : "";
}

/**
 * Repeats until the phone leaves. It ignores sessions for now, so until pause exists on the website,
 * quitting the app is the way to stop it.
 */
const PRESENT_REMINDER_MS = 30_000;

/**
 * Two copies polling the same device would halve the spacing the window and debounce are tuned
 * against, so the second instance exits rather than joining in.
 */
if (!app.requestSingleInstanceLock()) {
  console.log("Perimeter is already running — check the menu bar.");
  app.quit();
} else if (envAddress.kind === "invalid") {
  // A tray app launched at login has no terminal, so the reason has to be a dialog. Not falling back
  // to the saved phone: a typo in .env should be noticed, not quietly worked around.
  dialog.showErrorBox("Perimeter can't start", invalidEnvAddress(envAddress.value));
  app.exit(1);
} else {
  void app.whenReady().then(launch);
}

// The default quits once the last window closes, and the picker is the only window a tray app has.
app.on("window-all-closed", () => {});

async function launch(): Promise<void> {
  // The tray is the app; the picker is the only window, and only now and then.
  app.dock?.hide();

  const settingsDir = app.getPath("userData");
  if (envAddress.kind === "set") {
    start(envAddress.device, { settingsDir, fromEnv: true });
    return;
  }

  const saved = (await readSettings(settingsDir)).iphoneAddress;
  if (saved !== null) {
    start({ address: saved }, { settingsDir, fromEnv: false });
    return;
  }

  // First run. Closing the picker without choosing leaves nothing to watch, so it means quit.
  const chosen = await pickIphone({ firstRun: true });
  if (chosen === null) {
    app.quit();
    return;
  }
  await save(settingsDir, chosen);
  start(chosen, { settingsDir, fromEnv: false });
}

/** A failed save still runs with the chosen phone; the cost is being asked again next launch. */
async function save(settingsDir: string, device: DeviceMatcher): Promise<void> {
  try {
    await saveSettings(settingsDir, { iphoneAddress: device.address });
  } catch (error) {
    console.error(`${stamp()}  couldn't save the chosen iPhone:`, error);
  }
}

function start(initial: DeviceMatcher, where: { readonly settingsDir: string; readonly fromEnv: boolean }): void {
  let device = initial;
  let view: StatusView = STARTING;
  const tray = new Tray(trayImage(view));

  const render = (): void => {
    tray.setImage(trayImage(view));
    tray.setToolTip(tooltip(view));
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(
          { view, openAtLogin: app.getLoginItemSettings().openAtLogin, iphoneFromEnv: where.fromEnv },
          {
            openSettings: () => void shell.openExternal(websiteUrl),
            changeIphone: () => void changeIphone(),
            setOpenAtLogin: (openAtLogin) => {
              app.setLoginItemSettings({ openAtLogin });
              render();
            },
            quit: () => app.quit(),
          },
        ),
      ),
    );
  };

  render();

  let current: ReportedPresence | null = null;
  let reminder: NodeJS.Timeout | undefined;
  const cancelReminder = (): void => clearInterval(reminder);

  const watch = (phone: DeviceMatcher): MonitorHandle => {
    previousFill = 0;
    console.log(
      `Watching ${phone.address} every ${config.pollIntervalMs / 1000}s ` +
        `(away below ${config.filter.awayBelow}, present above ${config.filter.presentAbove} dBm, ` +
        `median of ${config.filter.windowSize}, debounce ${config.filter.debounce}, dropout after ${config.dropoutSamples}). ` +
        `Quit from the menu bar.`,
    );
    return startMonitor({
      device: phone,
      config,
      onEvent: (event) => {
        current = event.presence;
        void sendPresenceEvent(apiUrl, event, new Date()).then((result) => {
          if (!result.ok) console.warn(`${stamp()}  event not sent, dropped (${result.reason})`);
        });

        view = viewOf(event);
        render();
        notify(event);
        cancelReminder();
        if (event.presence === "present") {
          // Any later transition cancels this, so firing at all means the phone never left.
          reminder = setInterval(() => notify(event), PRESENT_REMINDER_MS);
        }
        console.log(`${stamp()}  → ${event.presence.toUpperCase()} (${event.cause})`);

        // TODO: once the API has session rules, the heartbeat's `{ notify }` replaces the unconditional
        // `present` nudge in `nudgeFor`. Until then it's always false, so it's ignored.
      },
      onReading: (reading, monitorState) => {
        // Ungated, unlike the CLI's equivalent: a packaged tray app has nowhere to print, so this only
        // ever shows when someone launched it from a terminal — which is itself the request to watch it.
        if (reading.ok) {
          console.log(`${stamp()}  ${reading.rssi} dBm${filling(monitorState)}`);
          return;
        }
        console.warn(`${stamp()}  no reading (${reading.reason}: ${reading.detail}) ×${monitorState.failures}`);
      },
      onError: (error) => console.error(`${stamp()}  handler failed:`, error),
    });
  };

  let monitor = watch(device);

  /**
   * A different phone starts from nothing: a fresh monitor (its window and debounce state belong to
   * the old phone's signal), no reported state until the new one earns one, and no pending reminder.
   * stop() discards a poll already in flight, so nothing from the old phone arrives after this.
   */
  async function changeIphone(): Promise<void> {
    const chosen = await pickIphone({ firstRun: false });
    if (chosen === null || normalizeAddress(chosen.address) === normalizeAddress(device.address)) return;
    await save(where.settingsDir, chosen);

    monitor.stop();
    cancelReminder();
    current = null;
    view = STARTING;
    device = chosen;
    render();
    monitor = watch(device);
  }

  const stopHeartbeat = startHeartbeat(
    apiUrl,
    () => current,
    (reason) => console.warn(`${stamp()}  heartbeat not sent (${reason})`),
  );

  // A gap in heartbeats is how the API will notice the Mac was asleep; the tray only has to make
  // sure the filter isn't judging the present on samples from before it.
  // The reminder keeps running: reset() keeps `emitted`, so a phone still here after the wake never
  // re-announces `present`, and cancelling here would silence it for good. If it moved while the Mac
  // slept, the transition that follows cancels it as usual.
  powerMonitor.on("resume", () => monitor.reset());

  app.on("will-quit", () => {
    cancelReminder();
    stopHeartbeat();
    monitor.stop();
  });
}

function trayImage(view: StatusView): Electron.NativeImage {
  // `@2x` and the `Template` suffix are both filename conventions macOS reads: the first picks the
  // Retina variant, the second says treat the alpha as a mask so the icon inverts on a dark bar.
  const image = nativeImage.createFromPath(join(__dirname, "..", "assets", "tray", `${iconName(view)}.png`));
  image.setTemplateImage(true);
  return image;
}

function notify(event: PresenceEvent): void {
  const nudge = nudgeFor(event);
  if (nudge === null || !Notification.isSupported()) return;

  const notification = new Notification({ title: nudge.title, body: nudge.body });
  if (nudge.offersBluetoothSettings) {
    notification.on("click", () => void shell.openExternal(BLUETOOTH_SETTINGS));
  }
  // macOS rejects a refused notification without a prompt or a Settings entry; this is the only trace.
  notification.on("failed", (_event, error) => console.error(`${stamp()}  notification failed: ${error}`));
  notification.show();
}
