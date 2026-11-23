"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

/** The address bar's query string, or null while rendering on the server. */
export function useLocationSearch(): string | null {
  return useSyncExternalStore(
    never,
    () => window.location.search,
    () => null,
  );
}

/** Whether a CSS media query currently matches. False on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

let viewport = { w: 1280, h: 800 };
/** The window's size. A fixed desktop size on the server. */
export function useViewport(): { w: number; h: number } {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => {
      if (viewport.w !== window.innerWidth || viewport.h !== window.innerHeight) viewport = { w: window.innerWidth, h: window.innerHeight };
      return viewport;
    },
    () => viewport,
  );
}
