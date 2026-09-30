// Type-only import of electron, so the menu's shape stays testable in plain vitest — requiring the
// electron module outside an electron process throws.
import type { MenuItemConstructorOptions } from "electron";
import { statusTitle, type StatusView } from "./presentation";

export interface TrayActions {
  readonly openSettings: () => void;
  readonly setOpenAtLogin: (openAtLogin: boolean) => void;
  readonly quit: () => void;
}

export interface TrayModel {
  readonly view: StatusView;
  readonly openAtLogin: boolean;
}

/**
 * Deliberately has no pause or break item. Breaks are website-only because the friction is the
 * feature — a two-click pause in the menu bar defeats the point of the tool.
 */
export function trayMenu(model: TrayModel, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: statusTitle(model.view), enabled: false },
    { type: "separator" },
    { label: "Settings…", click: () => actions.openSettings() },
    { type: "separator" },
    {
      label: "Open at Login",
      type: "checkbox",
      checked: model.openAtLogin,
      click: (item) => actions.setOpenAtLogin(item.checked),
    },
    { label: "Quit Perimeter", accelerator: "Command+Q", click: () => actions.quit() },
  ];
}
