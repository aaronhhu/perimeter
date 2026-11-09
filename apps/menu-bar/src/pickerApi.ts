// The contract between the picker window and the main process. No imports, so the renderer (built
// against DOM types, not Node's) can import its types without pulling in the sampler.

export interface PairedDevice {
  readonly name: string;
  readonly address: string;
  /** Apple's `device_minorType`, e.g. "Mobile Phone". Used to sort, never to filter: it isn't always there. */
  readonly kind: string | null;
  /** The iOS version on an iPhone. Mostly there to tell an old phone from a new one with the same name. */
  readonly firmware: string | null;
  /** Null when listed without a reading: out of range, its Bluetooth off, or a device that doesn't advertise. */
  readonly rssi: number | null;
}

export type DeviceList =
  | { readonly ok: true; readonly devices: readonly PairedDevice[] }
  | { readonly ok: false; readonly reason: "bluetooth-off" | "failed"; readonly detail: string };

export interface PickerApi {
  readonly listDevices: () => Promise<DeviceList>;
  readonly choose: (address: string) => Promise<void>;
  readonly openBluetoothSettings: () => Promise<void>;
}

export const PICKER_CHANNELS = {
  list: "picker:list",
  choose: "picker:choose",
  openBluetoothSettings: "picker:open-bluetooth-settings",
} as const;
