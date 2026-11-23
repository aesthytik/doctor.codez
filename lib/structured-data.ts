// What the page tells search engines about itself (schema.org, as JSON-LD), and the
// questions and answers shown in the "About the count" panel. The two are built from the
// same list so the markup never says anything the page does not.
import { longDate, venueNameOn } from "./data/derive";
import type { CareerFacts } from "./data/facts";
import { TEAMS } from "./data/types";
import { MAKER, OG_IMAGE, SITE_NAME, SITE_URL, headline, summary } from "./site";

const num = (n: number) => n.toLocaleString("en-GB");

/** "a, b and c". */
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export type Answer = { q: string; a: string };

export function answers(f: CareerFacts, countingRule: string): Answer[] {
  const { first, latest } = f;
  const where = (x: CareerFacts["first"]) => `${venueNameOn(x.venue, x.goal.date)} in ${x.venue.city}`;
  const teams = f.byTeam.map((t) => `${num(t.count)} for ${t.name}`);
  return [
    {
      q: "How many goals has Cristiano Ronaldo scored?",
      a: `${num(f.total)} in official senior matches, as of ${longDate(f.asOf)}: ${list(teams)}.`,
    },
    f.remaining > 0
      ? {
          q: `How many goals does Ronaldo need to reach ${num(f.target)}?`,
          a: `${num(f.remaining)} more. He has ${num(f.total)}; the most recent came on ${longDate(latest.goal.date)} for ${TEAMS[latest.goal.team].name} against ${latest.goal.opponent}, at ${where(latest)}.`,
        }
      : {
          q: `When did Ronaldo score his ${num(f.target)}th goal?`,
          a: (() => {
            const t = f.milestones[f.milestones.length - 1];
            return `On ${longDate(t.goal.date)}, for ${TEAMS[t.goal.team].name} against ${t.goal.opponent}, at ${where(t)}.`;
          })(),
        },
    {
      q: "When and where did Ronaldo score his first goal?",
      a: `On ${longDate(first.goal.date)}, for ${TEAMS[first.goal.team].name} against ${first.goal.opponent} in the ${first.goal.comp}, at ${where(first)}.`,
    },
    {
      q: "Where has Ronaldo scored the most goals?",
      a: `At ${f.topVenues[0].name} in ${f.topVenues[0].city}: ${num(f.topVenues[0].count)} goals. Next come ${list(
        f.topVenues.slice(1, 4).map((v) => `${v.name} (${num(v.count)})`),
      )}. In all he has scored at ${num(f.stadiums)} stadiums in ${num(f.countries)} countries.`,
    },
    { q: "Which goals are counted?", a: countingRule },
    {
      q: "Is this an official site?",
      a: "No. It is an unofficial fan tribute, not affiliated with Cristiano Ronaldo or any club, league or federation. It uses no player photographs or club crests.",
    },
  ];
}

/** One JSON-LD graph for the page: the site, the page, who it is about, and the answers. */
export function structuredData(f: CareerFacts, faq: Answer[]) {
  const id = (name: string) => `${SITE_URL}/#${name}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": id("website"),
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: summary(f),
        inLanguage: "en",
        creator: { "@type": "Person", name: MAKER.name, url: MAKER.url },
      },
      {
        "@type": "WebPage",
        "@id": id("webpage"),
        url: `${SITE_URL}/`,
        name: headline(f),
        description: summary(f),
        inLanguage: "en",
        isPartOf: { "@id": id("website") },
        about: { "@id": id("ronaldo") },
        dateModified: f.asOf,
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE_URL}/og.png`, ...OG_IMAGE },
      },
      {
        "@type": "Person",
        "@id": id("ronaldo"),
        name: "Cristiano Ronaldo",
        sameAs: ["https://en.wikipedia.org/wiki/Cristiano_Ronaldo", "https://www.wikidata.org/wiki/Q11571"],
      },
      {
        "@type": "FAQPage",
        "@id": id("faq"),
        isPartOf: { "@id": id("webpage") },
        mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  };
}
