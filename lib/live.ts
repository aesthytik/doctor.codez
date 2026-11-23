"use client";

// Keeps an open page current. While the tab is visible the page asks for a tiny status
// file: every minute around a match, every ten minutes otherwise. When the file's
// version stamp differs from the data the page holds, the new dataset is fetched and
// swapped in. That is how a new goal, and the goal-1,000 celebration, reach a page
// that was left open, without a refresh.
import { useMemo, useSyncExternalStore } from "react";
import { pollDelay, type Published, type Status } from "@/lib/data/publish";

export type Live = Published & { v: string; celebration: Status["celebration"] };

const STATUS_URL = "/live/status.json";
const DATA_URL = "/live/data.json";

let current: Live | null = null;
let busy = false;
let timer = 0;
/** Kick-off times from the last status file read. */
let fixtures: string[] | undefined;
const listeners = new Set<() => void>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function poll() {
  if (busy || !current || document.visibilityState !== "visible") return;
  busy = true;
  try {
    const status = await getJson<Status>(STATUS_URL);
    fixtures = status.next;
    let next = current;
    if (status.v !== current.v) {
      const data = await getJson<Published & { v: string }>(`${DATA_URL}?v=${encodeURIComponent(status.v)}`);
      // Mid-deploy the two files can briefly be out of step; wait for a matching pair.
      if (data.v === status.v && Array.isArray(data.goals) && data.goals.length > 0 && Array.isArray(data.venues)) {
        next = { v: data.v, goals: data.goals, venues: data.venues, celebration: status.celebration === "hold" ? "hold" : "auto" };
      }
    } else if ((status.celebration === "hold") !== (current.celebration === "hold")) {
      next = { ...current, celebration: status.celebration === "hold" ? "hold" : "auto" };
    }
    if (next !== current) {
      current = next;
      listeners.forEach((l) => l());
    }
  } catch {
    // Offline, or the site is mid-deploy: the next tick will try again.
  } finally {
    busy = false;
  }
}

/** Check now, then again after a wait that depends on whether a match is on. `?poll=5` fixes the wait, for testing. */
function schedule(first = false) {
  const asked = Number(new URLSearchParams(window.location.search).get("poll"));
  const wait = Number.isFinite(asked) && asked >= 3 ? asked * 1000 : first ? 60_000 : pollDelay(fixtures, Date.now());
  timer = window.setTimeout(async () => {
    await poll();
    if (listeners.size > 0) schedule();
  }, wait);
}

const idle = () => () => {};

/** The dataset to draw: what the page was built with, replaced by newer data as it is published. */
export function useLive(built: Live, enabled: boolean): Live {
  const subscribe = useMemo(
    () =>
      enabled
        ? (onChange: () => void) => {
            current ??= built;
            listeners.add(onChange);
            if (listeners.size === 1) {
              schedule(true);
              document.addEventListener("visibilitychange", poll);
            }
            return () => {
              listeners.delete(onChange);
              if (listeners.size === 0) {
                window.clearTimeout(timer);
                document.removeEventListener("visibilitychange", poll);
              }
            };
          }
        : idle,
    [built, enabled],
  );
  return useSyncExternalStore(
    subscribe,
    () => (enabled ? (current ?? built) : built),
    () => built,
  );
}
