// The committed dataset, read once when the site is built: what the page is sent, and
// the career in numbers. Server-side only; the browser gets its data from app/page.tsx.
import goalsFile from "@/data/goals.json";
import venuesFile from "@/data/venues.json";
import { careerFacts } from "./facts";
import { forBrowser } from "./publish";

export const published = forBrowser(goalsFile.goals, venuesFile.venues);
export const facts = careerFacts(published.goals, published.venues);
