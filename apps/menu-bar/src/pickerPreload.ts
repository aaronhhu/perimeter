// The only thing the picker page can reach. The window runs sandboxed with no Node, so this narrow
// bridge is the whole surface a page showing device names (which anyone can set) gets.
import { contextBridge, ipcRenderer } from "electron";
import { PICKER_CHANNELS, type PickerApi } from "./pickerApi";

const api: PickerApi = {
  listDevices: () => ipcRenderer.invoke(PICKER_CHANNELS.list),
  choose: (address) => ipcRenderer.invoke(PICKER_CHANNELS.choose, address),
  openBluetoothSettings: () => ipcRenderer.invoke(PICKER_CHANNELS.openBluetoothSettings),
};

contextBridge.exposeInMainWorld("perimeter", api);
