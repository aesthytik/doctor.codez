import Experience from "@/components/Experience";
import goalsFile from "@/data/goals.json";
import venuesFile from "@/data/venues.json";
import type { Goal, Venue } from "@/lib/data/types";

export default function Home() {
  // Only what the page draws is sent to the browser.
  const goals = (goalsFile.goals as unknown as (Goal & { src: string[] })[]).map(({ src: _src, ...g }) => ({ ...g, src: [] }) as Goal);
  const venues = (venuesFile.venues as unknown as (Venue & Record<string, unknown>)[]).map(
    ({ id, name, city, country, lat, lng, periodNames, demolished }) => ({ id, name, city, country, lat, lng, periodNames, demolished }) as Venue,
  );
  return <Experience goals={goals} venues={venues} />;
}
