import { DEFAULT_MONITOR_CONFIG, startMonitor, type MonitorState, type PresenceEvent } from "./monitor";
import { DEFAULT_DEVICE, type Reading } from "./sampler";

const device = { address: process.env["PERIMETER_IPHONE_ADDRESS"] ?? DEFAULT_DEVICE.address };
const debug = process.env["PERIMETER_DEBUG"] === "1";

/** Local, not UTC: these logs get read next to a wall clock. */
const stamp = () => new Date().toTimeString().slice(0, 8);

function onEvent(event: PresenceEvent): void {
  const detail = event.smoothed === null ? event.cause : `${event.cause}, smoothed ${event.smoothed} dBm`;
  console.log(`${stamp()}  → ${event.presence.toUpperCase()} (${detail})`);

  // TODO: POST the transition to apps/api once it exists. Transitions only, never raw RSSI —
  // `smoothed` rides along as optional debug telemetry.
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
