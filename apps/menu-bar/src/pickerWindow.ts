import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { listPairedDevices } from "./devices";
import { isBluetoothAddress } from "./env";
import { PICKER_CHANNELS } from "./pickerApi";
import type { DeviceMatcher } from "./sampler";

/** macOS's own Bluetooth pane. */
export const BLUETOOTH_SETTINGS = "x-apple.systempreferences:com.apple.BluetoothSettings";

let pending: { window: BrowserWindow; result: Promise<DeviceMatcher | null> } | null = null;

/**
 * Resolves with the chosen phone, or null if the window was closed without choosing. One window at a
 * time: asking again while it's open brings the existing one forward.
 */
export function pickIphone(options: { readonly firstRun: boolean }): Promise<DeviceMatcher | null> {
  if (pending !== null) {
    pending.window.show();
    app.focus({ steal: true });
    return pending.result;
  }

  const window = new BrowserWindow({
    width: 460,
    height: 540,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: "Choose your iPhone",
    webPreferences: {
      preload: join(__dirname, "pickerPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const result = new Promise<DeviceMatcher | null>((resolve) => {
    let chosen: DeviceMatcher | null = null;
    const fromThisWindow = (event: IpcMainInvokeEvent): boolean => event.sender === window.webContents;

    ipcMain.handle(PICKER_CHANNELS.list, (event) => {
      if (!fromThisWindow(event)) throw new Error("not the picker window");
      return listPairedDevices();
    });
    ipcMain.handle(PICKER_CHANNELS.choose, (event, address: unknown) => {
      if (!fromThisWindow(event)) throw new Error("not the picker window");
      if (typeof address !== "string" || !isBluetoothAddress(address)) throw new Error("not a Bluetooth address");
      chosen = { address };
      window.close();
    });
    ipcMain.handle(PICKER_CHANNELS.openBluetoothSettings, async (event) => {
      if (!fromThisWindow(event)) throw new Error("not the picker window");
      await shell.openExternal(BLUETOOTH_SETTINGS);
    });

    window.on("closed", () => {
      for (const channel of Object.values(PICKER_CHANNELS)) ipcMain.removeHandler(channel);
      pending = null;
      resolve(chosen);
    });
  });

  // The Dock icon is hidden, so a newly shown window doesn't come forward on its own.
  window.once("ready-to-show", () => {
    window.show();
    app.focus({ steal: true });
  });
  void window.loadFile(join(__dirname, "..", "picker", "index.html"), {
    query: { firstRun: String(options.firstRun) },
  });

  pending = { window, result };
  return result;
}
