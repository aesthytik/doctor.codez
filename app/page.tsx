import Experience from "@/components/Experience";
import goalsFile from "@/data/goals.json";
import overrides from "@/data/overrides.json";
import venuesFile from "@/data/venues.json";
import { celebrationSetting, forBrowser, versionOf } from "@/lib/data/publish";

export default function Home() {
  // Only what the page draws is sent to the browser.
  const data = forBrowser(goalsFile.goals, venuesFile.venues);
  return <Experience goals={data.goals} venues={data.venues} version={versionOf(data)} celebration={celebrationSetting(overrides)} />;
}
