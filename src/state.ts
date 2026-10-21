import type { ViewId } from "./settings";

/**
 * What the user is looking at right now, shared by every view: the current view, the selected city,
 * and how far time has been scrubbed away from now.
 */
export interface AppState {
  view: ViewId;
  /** cityKey of the selected city, or null. */
  selectedKey: string | null;
  /** Minutes added to the current time while scrubbing; 0 means "now". */
  offsetMinutes: number;
  /** Whether the selected city's details card is open on the map. */
  detailsOpen: boolean;
  /** The clock-change alert the user has dismissed (so it doesn't come back until the next one). */
  dismissedAlert: string;
}

export const state: AppState = {
  view: "map",
  selectedKey: null,
  offsetMinutes: 0,
  detailsOpen: false,
  dismissedAlert: "",
};

const listeners = new Set<() => void>();

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener());
}

export function onStateChange(listener: () => void): void {
  listeners.add(listener);
}

/** The moment every view should show: now, plus any scrubbing. */
export function shownTime(): Date {
  return new Date(Date.now() + state.offsetMinutes * 60_000);
}
