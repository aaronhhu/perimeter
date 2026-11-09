// Runs in the sandboxed picker window: DOM only, no Node. Everything it can do goes through
// `window.perimeter` (src/pickerPreload.ts). Device names are user-set text, so they go in with
// textContent, never as HTML.
import type { DeviceList, PairedDevice, PickerApi } from "../src/pickerApi";

declare global {
  interface Window {
    readonly perimeter: PickerApi;
  }
}

const api = window.perimeter;
const firstRun = new URLSearchParams(location.search).get("firstRun") === "true";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`picker page is missing #${id}`);
  return element as T;
};

const intro = byId("intro");
const status = byId("status");
const list = byId<HTMLUListElement>("devices");
const duplicates = byId("duplicates");
const refresh = byId<HTMLButtonElement>("refresh");
const bluetooth = byId<HTMLButtonElement>("bluetooth");
const cancel = byId<HTMLButtonElement>("cancel");
const choose = byId<HTMLButtonElement>("choose");

let selected: string | null = null;

intro.textContent = firstRun
  ? "Perimeter watches your iPhone's Bluetooth signal to tell whether it's at your desk. " +
    "Pick it from the devices paired with this Mac. Nothing is installed on the phone."
  : "Pick the phone Perimeter should watch. Switching starts a fresh reading, so expect about half a minute before it shows a state.";
cancel.textContent = firstRun ? "Quit" : "Cancel";

function show(result: DeviceList): void {
  list.replaceChildren();
  duplicates.hidden = true;
  selected = null;
  choose.disabled = true;

  if (!result.ok) {
    status.textContent =
      result.reason === "bluetooth-off"
        ? "Bluetooth is off on this Mac. Turn it on, then click Refresh."
        : `Couldn't read this Mac's Bluetooth devices (${result.detail}).`;
    return;
  }

  if (result.devices.length === 0) {
    status.textContent =
      "No devices are paired with this Mac. Pair your iPhone in Bluetooth Settings, then click Refresh.";
    return;
  }

  status.textContent =
    "Don't see your iPhone? It has to be paired with this Mac first — pair it in Bluetooth Settings, then click Refresh.";

  const names = result.devices.map((device) => device.name);
  duplicates.hidden = names.length === new Set(names).size;

  for (const device of result.devices) list.append(row(device));
}

function row(device: PairedDevice): HTMLLIElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "device";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", "false");
  button.dataset["address"] = device.address;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = device.name;

  const meta = document.createElement("span");
  meta.className = "meta";
  const signal = document.createElement("span");
  if (device.rssi !== null) {
    signal.className = "live";
    signal.textContent = `Signal ${device.rssi} dBm`;
  } else {
    signal.textContent = "No signal";
  }
  meta.append(signal, ` · ${details(device)}`);

  button.append(name, meta);
  button.addEventListener("click", () => select(device.address));
  button.addEventListener("dblclick", () => void confirm());

  const item = document.createElement("li");
  item.append(button);
  return item;
}

function details(device: PairedDevice): string {
  const parts: string[] = [];
  if (device.kind !== null) parts.push(device.kind);
  if (device.kind === "Mobile Phone" && device.firmware !== null) parts.push(`iOS ${device.firmware}`);
  parts.push(device.address);
  return parts.join(" · ");
}

function select(address: string): void {
  selected = address;
  for (const button of list.querySelectorAll<HTMLButtonElement>(".device")) {
    button.setAttribute("aria-checked", String(button.dataset["address"] === address));
  }
  choose.disabled = false;
}

async function load(): Promise<void> {
  refresh.disabled = true;
  status.textContent = "Looking for paired devices…";
  try {
    show(await api.listDevices());
  } finally {
    refresh.disabled = false;
  }
}

async function confirm(): Promise<void> {
  if (selected === null) return;
  choose.disabled = true;
  await api.choose(selected);
}

refresh.addEventListener("click", () => void load());
bluetooth.addEventListener("click", () => void api.openBluetoothSettings());
cancel.addEventListener("click", () => window.close());
choose.addEventListener("click", () => void confirm());

void load();
