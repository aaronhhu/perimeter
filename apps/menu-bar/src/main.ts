import { app, Menu, Notification, Tray, nativeImage, powerMonitor, shell } from "electron";
import { join } from "node:path";
import {
  DEFAULT_MONITOR_CONFIG,
  startMonitor,
  type MonitorHandle,
  type MonitorState,
  type PresenceEvent,
} from "./monitor";
import { DEFAULT_DEVICE } from "./sampler";
import { nudgeFor, STARTING, iconName, tooltip, viewOf, type StatusView } from "./presentation";
import { trayMenu } from "./tray";

const device = { address: process.env["PERIMETER_IPHONE_ADDRESS"] ?? DEFAULT_DEVICE.address };

// TODO: the architecture wants a short-lived token on this URL so opening settings doesn't mean
// logging in again. Nothing to sign yet — apps/api doesn't exist.
const websiteUrl = process.env["PERIMETER_WEBSITE_URL"] ?? "http://localhost:5173";

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

/** macOS's own Bluetooth pane. Offered because a nudge the user can't act on from the notification is half a nudge. */
const BLUETOOTH_SETTINGS = "x-apple.systempreferences:com.apple.BluetoothSettings";

/**
 * Two copies polling the same device would halve the spacing the window and debounce are tuned
 * against, so the second instance exits rather than joining in.
 */
if (!app.requestSingleInstanceLock()) {
  console.log("Perimeter is already running — check the menu bar.");
  app.quit();
} else {
  void app.whenReady().then(start);
}

function start(): void {
  // Tray-only: no window is ever created, so a Dock icon would be a dead target.
  app.dock?.hide();

  let view: StatusView = STARTING;
  const tray = new Tray(trayImage(view));

  const render = (): void => {
    tray.setImage(trayImage(view));
    tray.setToolTip(tooltip(view));
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(
          { view, openAtLogin: app.getLoginItemSettings().openAtLogin },
          {
            openSettings: () => void shell.openExternal(websiteUrl),
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

  let reminder: NodeJS.Timeout | undefined;
  const cancelReminder = (): void => clearInterval(reminder);

  const monitor: MonitorHandle = startMonitor({
    device,
    config,
    onEvent: (event) => {
      view = viewOf(event);
      render();
      notify(event);
      cancelReminder();
      if (event.presence === "present") {
        // Any later transition cancels this, so firing at all means the phone never left.
        reminder = setInterval(() => notify(event), PRESENT_REMINDER_MS);
      }
      console.log(`${stamp()}  → ${event.presence.toUpperCase()} (${event.cause})`);

      // TODO: POST the transition to apps/api once it exists, plus a 60s heartbeat of the current
      // state. Transitions only, never raw RSSI — `smoothed` rides along as debug telemetry.
      // The response's `{ notify }` then replaces the unconditional `present` nudge in `nudgeFor`.
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

  const { pollIntervalMs, filter, dropoutSamples } = config;
  console.log(
    `Watching ${device.address} every ${pollIntervalMs / 1000}s ` +
      `(away below ${filter.awayBelow}, present above ${filter.presentAbove} dBm, ` +
      `median of ${filter.windowSize}, debounce ${filter.debounce}, dropout after ${dropoutSamples}). ` +
      `Quit from the menu bar.`,
  );

  // A gap in heartbeats is how the API will notice the Mac was asleep; the tray only has to make
  // sure the filter isn't judging the present on samples from before it.
  // The reminder keeps running: reset() keeps `emitted`, so a phone still here after the wake never
  // re-announces `present`, and cancelling here would silence it for good. If it moved while the Mac
  // slept, the transition that follows cancels it as usual.
  powerMonitor.on("resume", () => monitor.reset());

  app.on("will-quit", () => {
    cancelReminder();
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
