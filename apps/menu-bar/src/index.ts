import { DEFAULT_MONITOR_CONFIG, startMonitor, type MonitorState, type PresenceEvent } from "./monitor";
import { DEFAULT_DEVICE, type Reading } from "./sampler";

const device = { address: process.env["PERIMETER_IPHONE_ADDRESS"] ?? DEFAULT_DEVICE.address };
const debug = process.env["PERIMETER_DEBUG"] === "1";

/** Local, not UTC: these logs get read next to a wall clock. */
const stamp = () => new Date().toTimeString().slice(0, 8);

function onEvent(event: PresenceEvent): void {
  const detail = event.smoothed === null ? event.cause : `${event.cause}, smoothed ${event.smoothed} dBm`;
  console.log(`${stamp()}  → ${event.presence.toUpperCase()} (${detail})`);

  // Stands in for the macOS notification until there's an Electron shell to fire one. `unknown` is
  // the one state the Mac can't resolve by itself, so it's the one that has to ask.
  if (event.presence === "unknown") {
    const nudge =
      event.cause === "bluetooth-off"
        ? "Bluetooth is off on this Mac — turn it on to keep tracking."
        : event.cause === "cold-start"
          ? "Haven't seen your phone yet — nothing counts until it turns up."
          : "Can't see your phone — is Bluetooth off?";
    console.log(`${stamp()}     ${nudge}`);
  }
  if (event.presence === "present") {
    console.log(`${stamp()}     Your phone is in range — take it out of the perimeter.`);
  }

  // TODO: POST the transition to apps/api once it exists. Transitions only, never raw RSSI —
  // `smoothed` rides along as optional debug telemetry.
  // TODO: `cold-start` has no way to resolve into credit yet. The sensor can't, ever — that needs
  // the user asserting "it's in the other room", which belongs on the website next to pause.
}

function onReading(reading: Reading, state: MonitorState): void {
  if (reading.ok) {
    if (debug) console.log(`${stamp()}  ${reading.rssi} dBm`);
    return;
  }
  // Logged debug or not: these are the silent-failure modes worth seeing.
  console.warn(`${stamp()}  no reading (${reading.reason}: ${reading.detail}) ×${state.failures}`);
}

const monitor = startMonitor({
  device,
  onEvent,
  onReading,
  onError: (error) => console.error(`${stamp()}  handler failed:`, error),
});

const { pollIntervalMs, filter, dropoutSamples } = DEFAULT_MONITOR_CONFIG;
console.log(
  `Watching ${device.address} every ${pollIntervalMs / 1000}s ` +
    `(away below ${filter.awayBelow}, present above ${filter.presentAbove} dBm, ` +
    `median of ${filter.windowSize}, debounce ${filter.debounce}, dropout after ${dropoutSamples}). Ctrl-C to stop.`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    monitor.stop();
    console.log(`\n${stamp()}  stopped.`);
    process.exit(0);
  });
}
