// The career in words and numbers: what the globe shows, for a reader, a screen reader
// or a search engine. It is written when the site is built, from the same dataset, and
// opens from "About the count" in the footer (components/Experience.tsx).
import type { ReactNode } from "react";
import { longDate, venueNameOn } from "@/lib/data/derive";
import type { CareerFacts, GoalAt } from "@/lib/data/facts";
import { TEAMS } from "@/lib/data/types";
import { SITE_NAME } from "@/lib/site";
import type { Answer } from "@/lib/structured-data";

const num = (n: number) => n.toLocaleString("en-GB");
const link = "text-text underline decoration-gold/40 underline-offset-4 transition hover:text-gold-hi hover:decoration-gold";

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.28em] text-faint">{children}</div>;
}
function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 mt-9 border-t border-line pt-5 font-serif text-[22px] leading-tight text-text">{children}</h3>;
}
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="numerals text-gilded text-[2.9rem] sm:text-[3.6rem]">{value}</div>
      <Label>{label}</Label>
    </div>
  );
}
/** A goal as a line of text: who it was for and against, and where. */
function match({ goal, venue }: GoalAt): string {
  return `${TEAMS[goal.team].name} v ${goal.opponent}, ${goal.comp}, at ${venueNameOn(venue, goal.date)}, ${venue.city}`;
}

export default function About({ facts: f, faq }: { facts: CareerFacts; faq: Answer[] }) {
  const reached = f.remaining === 0;
  return (
    <article className="text-[14px] leading-relaxed text-dim">
      <Label>About the count</Label>
      <h2 id="about-title" className="mt-2 font-serif text-[30px] leading-[1.08] text-text sm:text-[38px]">
        Every Cristiano Ronaldo goal, where it was scored
      </h2>
      <p className="mt-4 text-[15px] text-text/85">
        {SITE_NAME} puts every goal of Cristiano Ronaldo&rsquo;s senior career on the globe as a point of light at the stadium where he scored it:{" "}
        <strong className="font-semibold text-gold-hi">{num(f.total)} goals</strong> at {num(f.stadiums)} stadiums in {num(f.countries)} countries, as of{" "}
        <time dateTime={f.asOf}>{longDate(f.asOf)}</time>.{" "}
        {reached ? (
          <>He has passed {num(f.target)}.</>
        ) : (
          <>
            He needs <strong className="font-semibold text-gold-hi">{num(f.remaining)} more</strong> to reach {num(f.target)}.
          </>
        )}{" "}
        {num(f.penalties)} of the {num(f.total)} were penalties.
      </p>

      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Figure value={num(f.total)} label="Career goals" />
        <Figure value={reached ? num(f.target) : num(f.remaining)} label={reached ? "Reached" : `To go to ${num(f.target)}`} />
        <Figure value={num(f.stadiums)} label="Stadiums" />
        <Figure value={num(f.countries)} label="Countries" />
      </div>

      <div className="grid gap-x-10 sm:grid-cols-2">
        <section>
          <Heading>Goals by team</Heading>
          <table className="w-full text-left">
            <caption className="sr-only">Cristiano Ronaldo&rsquo;s goals for each club and for Portugal</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Years</th>
                <th scope="col">Goals</th>
              </tr>
            </thead>
            <tbody>
              {f.byTeam.map((t) => (
                <tr key={t.team} className="border-b border-white/5 last:border-0">
                  <th scope="row" className="py-1.5 pr-3 font-normal text-text">
                    <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: TEAMS[t.team].color }} aria-hidden />
                    {t.name}
                  </th>
                  <td className="py-1.5 pr-3 text-[12px] text-faint">{t.years}</td>
                  <td className="py-1.5 text-right tabular-nums text-gold-hi">{num(t.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <Heading>Goals by competition</Heading>
          <table className="w-full text-left">
            <caption className="sr-only">The competitions Cristiano Ronaldo has scored most in</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Competition</th>
                <th scope="col">Goals</th>
              </tr>
            </thead>
            <tbody>
              {f.byCompetition.map((c) => (
                <tr key={c.name} className="border-b border-white/5 last:border-0">
                  <th scope="row" className="py-1.5 pr-3 font-normal text-text">
                    {c.name}
                  </th>
                  <td className="py-1.5 text-right tabular-nums text-gold-hi">{num(c.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <Heading>The stadiums where he has scored most</Heading>
        <ol className="grid gap-x-10 sm:grid-cols-2">
          {f.topVenues.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5">
              <span className="min-w-0">
                <a href={`/?venue=${v.id}`} data-venue={v.id} className={link}>
                  {v.name}
                </a>
                <span className="text-[12px] text-faint">
                  {" "}
                  {v.city}, {v.country}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-gold-hi">{num(v.count)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <Heading>Milestone goals</Heading>
        <ol>
          {f.milestones.map((m) => (
            <li key={m.goal.n} className="flex gap-4 border-b border-white/5 py-2 last:border-0">
              <a href={`/?goal=${m.goal.n}`} data-goal={m.goal.n} className="numerals w-[4.2rem] shrink-0 pt-1 text-right text-[26px] text-gold transition hover:text-gold-hi" aria-label={`Goal ${num(m.goal.n)} on the globe`}>
                {num(m.goal.n)}
              </a>
              <span>
                <time dateTime={m.goal.date} className="text-text">
                  {longDate(m.goal.date)}
                </time>
                <span className="block text-[13px]">{match(m)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <Heading>Questions</Heading>
        <dl>
          {faq.map(({ q, a }) => (
            <div key={q} className="mb-4 last:mb-0">
              <dt className="text-[15px] text-text">{q}</dt>
              <dd className="mt-1">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <Heading>How the count is kept</Heading>
        <p>
          Goals are read from ESPN&rsquo;s public match feed once a match has finished. The few the feed does not carry are entered by hand from named sources, and the totals are
          checked against published records. A new goal normally appears here within the hour after the final whistle.
        </p>
        {f.disputed.map((d) => (
          <p key={d.goal.n} className="mt-3">
            <a href={`/?goal=${d.goal.n}`} data-goal={d.goal.n} className={link}>
              Goal {num(d.goal.n)}
            </a>{" "}
            ({longDate(d.goal.date)}, v {d.goal.opponent}) is counted differently elsewhere. {d.note}
          </p>
        ))}
        <p className="mt-6 text-[12px] text-faint">
          An unofficial fan tribute. Not affiliated with Cristiano Ronaldo or any club, league or federation. No player photographs or club crests are used.
        </p>
      </section>
    </article>
  );
}
