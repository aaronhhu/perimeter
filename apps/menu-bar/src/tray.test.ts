import { describe, expect, it } from "vitest";
import type { MenuItem, MenuItemConstructorOptions } from "electron";
import { STARTING, viewOf } from "./presentation";
import { trayMenu, type TrayActions } from "./tray";

const noop = (): void => {};
const actions = (over: Partial<TrayActions> = {}): TrayActions => ({
  openSettings: noop,
  changeIphone: noop,
  setOpenAtLogin: noop,
  quit: noop,
  ...over,
});

const labels = (items: MenuItemConstructorOptions[]): string[] =>
  items.flatMap((item) => (typeof item.label === "string" ? [item.label] : []));

const away = viewOf({ presence: "away", smoothed: -72, cause: "signal" });

describe("trayMenu", () => {
  it("has no pause or break item — that lives on the website, where the friction is the point", () => {
    const text = labels(trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions())).join(" ").toLowerCase();
    expect(text).not.toMatch(/pause|break|snooze|stop tracking/);
  });

  it("leads with the status", () => {
    expect(labels(trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions()))[0]).toBe("Phone is away");
    expect(labels(trayMenu({ view: STARTING, openAtLogin: false, iphoneFromEnv: false }, actions()))[0]).toBe("Getting a reading\u2026");
  });

  it("shows no signal strength — the view only changes on a transition, so any number would sit frozen", () => {
    const text = labels(trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions())).join(" ");
    expect(text).not.toMatch(/dBm|-\d+|signal/i);
  });

  it("names the status lines and nothing else before the first separator", () => {
    const items = trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions());
    expect(items.findIndex((item) => item.type === "separator")).toBe(1);
  });

  it("never lets the status lines be clicked", () => {
    const [status] = trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions());
    expect(status?.enabled).toBe(false);
    expect(status?.click).toBeUndefined();
  });

  it("reflects the login-item setting and reports the checkbox's new value", () => {
    const seen: boolean[] = [];
    const items = trayMenu({ view: away, openAtLogin: true, iphoneFromEnv: false }, actions({ setOpenAtLogin: (on) => seen.push(on) }));
    const toggle = items.find((item) => item.type === "checkbox");

    expect(toggle?.checked).toBe(true);
    toggle?.click?.({ checked: false } as MenuItem, undefined, {} as never);
    expect(seen).toEqual([false]);
  });

  it("offers to change the iPhone, unless .env pins it — then picking would silently do nothing", () => {
    const picked: string[] = [];
    const items = trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: false }, actions({ changeIphone: () => picked.push("x") }));
    const change = items.find((item) => item.label === "Change iPhone\u2026");
    change?.click?.({} as MenuItem, undefined, {} as never);
    expect(picked).toHaveLength(1);

    const pinned = trayMenu({ view: away, openAtLogin: false, iphoneFromEnv: true }, actions());
    expect(labels(pinned)).not.toContain("Change iPhone\u2026");
    expect(pinned.find((item) => item.label === "iPhone Set in .env")?.enabled).toBe(false);
  });
});
