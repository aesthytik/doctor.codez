"use client";

import { useEffect, useRef, type RefObject } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { World } from "@/lib/data/derive";
import { GlobeController, type GlobeEvents, type GlobeOptions } from "./GlobeController";

type Props = GlobeEvents & {
  world: World;
  controller: RefObject<GlobeController | null>;
  options?: GlobeOptions;
};

/** Mounts the globe and hands its controller back through a ref. */
export default function GlobeCanvas({ world, controller, options, ...events }: Props) {
  const el = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without rebuilding the map when they change.
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });

  // The map is built once, with the dataset of the moment. Newer data is handed to the
  // controller afterwards (setWorld), so a new goal never rebuilds the map.
  const worldNow = useRef(world);
  useEffect(() => {
    worldNow.current = world;
    controller.current?.setWorld(world);
  }, [world, controller]);

  useEffect(() => {
    let dead = false;
    let made: GlobeController | null = null;
    GlobeController.create(
      el.current!,
      worldNow.current,
      {
        onHover: (h) => latest.current.onHover?.(h),
        onSelect: (h) => latest.current.onSelect?.(h),
        onView: (v) => latest.current.onView?.(v),
        onReady: () => latest.current.onReady?.(),
        onError: (m) => latest.current.onError?.(m),
      },
      options,
    )
      .then((c) => {
        if (dead) return c.destroy();
        made = c;
        c.setWorld(worldNow.current);
        controller.current = c;
      })
      .catch((err) => latest.current.onError?.(String(err)));
    return () => {
      dead = true;
      made?.destroy();
      controller.current = null;
    };
    // Built once; options are read at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MapLibre's stylesheet sets position: relative on the container, so size it inline.
  return <div ref={el} style={{ position: "absolute", inset: 0 }} aria-label="Globe showing where each goal was scored" role="application" />;
}
