import { describe, expect, it } from "vitest";
import type { MenuItem, MenuItemConstructorOptions } from "electron";
import { STARTING, viewOf } from "./presentation";
import { trayMenu, type TrayActions } from "./tray";

const noop = (): void => {};
const actions = (over: Partial<TrayActions> = {}): TrayActions => ({
  openSettings: noop,
  setOpenAtLogin: noop,
  quit: noop,
  ...over,
});

const labels = (items: MenuItemConstructorOptions[]): string[] =>
  items.flatMap((item) => (typeof item.label === "string" ? [item.label] : []));

const away = viewOf({ presence: "away", smoothed: -72, cause: "signal" });

describe("trayMenu", () => {
  it("has no pause or break item — that lives on the website, where the friction is the point", () => {
    const text = labels(trayMenu({ view: away, openAtLogin: false }, actions())).join(" ").toLowerCase();
    expect(text).not.toMatch(/pause|break|snooze|stop tracking/);
  });

  it("leads with the status", () => {
    expect(labels(trayMenu({ view: away, openAtLogin: false }, actions()))[0]).toBe("Phone is away");
    expect(labels(trayMenu({ view: STARTING, openAtLogin: false }, actions()))[0]).toBe("Getting a reading\u2026");
  });

  it("shows no signal strength — the view only changes on a transition, so any number would sit frozen", () => {
    const text = labels(trayMenu({ view: away, openAtLogin: false }, actions())).join(" ");
    expect(text).not.toMatch(/dBm|-\d+|signal/i);
  });

  it("names the status lines and nothing else before the first separator", () => {
    const items = trayMenu({ view: away, openAtLogin: false }, actions());
    expect(items.findIndex((item) => item.type === "separator")).toBe(1);
  });

  it("never lets the status lines be clicked", () => {
    const [status] = trayMenu({ view: away, openAtLogin: false }, actions());
    expect(status?.enabled).toBe(false);
    expect(status?.click).toBeUndefined();
  });

  it("reflects the login-item setting and reports the checkbox's new value", () => {
    const seen: boolean[] = [];
    const items = trayMenu({ view: away, openAtLogin: true }, actions({ setOpenAtLogin: (on) => seen.push(on) }));
    const toggle = items.find((item) => item.type === "checkbox");

    expect(toggle?.checked).toBe(true);
    toggle?.click?.({ checked: false } as MenuItem, undefined, {} as never);
    expect(seen).toEqual([false]);
  });
});
