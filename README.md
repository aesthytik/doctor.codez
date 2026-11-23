# A Thousand Lights

Every goal of Cristiano Ronaldo's career as a point of light at the stadium where it was scored, on the road to 1,000.

An unofficial fan tribute. It is not affiliated with Cristiano Ronaldo, any club, league or federation, and uses no player photographs or club crests.

*(Working title. The repository name is historical.)*

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # static site in out/
pnpm validate   # check the dataset
pnpm test       # check the counting and update rules
```

Node 22.18 or newer (Vercel and the GitHub workflows use Node 26). The scripts are TypeScript run directly by Node; they need no build step.

Useful addresses while developing:

| Address | What it shows |
|---|---|
| `/?preview=1000` | The goal-1,000 celebration, rehearsed with simulated goals (clearly labelled) |
| `/?intro=0` | Skip the opening (`/?intro=1` plays it again; by itself it plays on a first visit only) |
| `/?venue=santiago-bernabeu` | Open straight onto one stadium |
| `/?goal=700` | Open straight onto one goal |
| `/?t=2012-06-01` | The career as it stood on a date |
| `/?holo=0` | Without the hologram on the horizon (`/?holo=drawn` shows the stand-in figure instead of the clip) |

## Where it lives

<https://a-thousand-lights.aesthytik.dev/>, hosted on Vercel. Every push to `main` is built and published automatically. A push to any other branch gets its own preview address, visible when signed in to Vercel. The site is plain files: nothing runs on a server.

The site's own address is written into its canonical link, sitemap and link previews. On Vercel it is the project's production domain; set `SITE_URL` (for example `https://example.com`) to use another. The site is verified in Google Search Console by the code in `lib/site.ts`, which must stay (`GOOGLE_SITE_VERIFICATION` overrides it). For Bing Webmaster Tools, set `BING_SITE_VERIFICATION` to the code it gives you and redeploy.

## How it works

- `components/globe/` draws the Earth with MapLibre GL (globe projection) from a world outline shipped with the site, and the lights with deck.gl. Street-level tiles are requested from OpenFreeMap only after someone zooms in, so the opening view and the celebration depend on no outside service.
- `components/HologramClip.tsx` is the hologram on the horizon: Panini America's animation of the celebration, played straight from GIPHY (never copied into this site) and shown as a blue negative with scan lines. Only the celebration part of the clip is played. `components/Hologram.tsx` is a figure drawn in code that stands in when GIPHY cannot be reached or the visitor has asked for reduced motion.
- `components/Experience.tsx` holds the interface state: the timeline, the stadium and goal on show, and the celebration.
- `lib/data/` turns the dataset into what is drawn: per-stadium totals, each goal's place in its stadium's spiral, and the clock behind the timeline.
- `lib/site.ts`, `lib/data/facts.ts` and `lib/structured-data.ts` are what search engines and link previews read: the title and description (which carry the current count), the schema.org description of the page, and the career in numbers. `components/About.tsx` shows the same numbers to a reader ("About the count" in the footer), so the page says in words what the globe shows in lights. `app/og.png/` draws the link-preview picture at build time; `app/sitemap.ts` and `app/robots.ts` write `sitemap.xml` and `robots.txt`.
- `lib/live.ts` keeps an open page current. The build publishes a tiny status file (`/live/status.json`); a page asks for it every minute around a match and every ten minutes otherwise, and fetches the new dataset when the version stamp has moved on. That is how a new goal, and the goal-1,000 celebration, reach a page that was left open.

## The dataset

`data/goals.json` holds one record per goal and is always built by script, never edited by hand. `data/venues.json` holds one record per stadium and is curated by hand; the validator checks it. The rules are in `scripts/lib/`, and `tests/` checks them against saved match records.

| File | What it is |
|---|---|
| `data/source/espn-goals.json` | Facts swept from ESPN's public match feed: who scored, when, where |
| `data/manual-goals.json` | Goals the feed does not carry, entered by hand with their sources |
| `data/overrides.json` | The counting rule, neutral-ground rulings and other hand corrections, each with its reason |
| `data/venues.json` | Curated stadiums with coordinates |
| `data/reference/` | Published totals and lists used only to cross-check |
| `data/source/season.json` | The current season's matches as read by the updater, and the next fixtures |

```bash
pnpm sweep                      # re-read the feed (cached; slow the first time)
pnpm data                       # rebuild data/goals.json from the sources above
pnpm validate                   # numbering, running scores, totals and stadium positions
node scripts/geocode-venues.ts  # propose coordinates for new stadiums
```

### Staying up to date

**Automatically.** The `Update goals` workflow runs every half hour through the hours Al-Nassr's matches finish (14:00 to 22:00 UTC) and once a night. Most runs make one request to the feed, find nothing new and stop. After a match it runs `scripts/update-latest.ts`, which re-reads the season's recent results, rebuilds the dataset and commits the change to `main`; Vercel then rebuilds the site. A goal normally appears within the hour after the final whistle.

The updater is cautious on purpose:

- It reads finished matches only, so a goal ruled out during play is never counted.
- A new goal is accepted only when the feed's two accounts of the match (the match record and the summary) agree. Otherwise the match is held and retried.
- The result must pass every check in `scripts/lib/checks.ts`.
- A count that would fall is never published by itself, and more than six new goals in one run is refused.
- It compares its count with the feed's own season totals for him and says so when they differ.
- A goal at a ground he has not scored at before is placed by matching the stadium's name, then by Wikidata, then at its city (marked approximate), and flagged for a person to check.

When something needs a person, the workflow opens one issue labelled `goal-updater` and, if it had to stop, fails the run. Nothing is published in that case.

```bash
node scripts/update-latest.ts --check     # is there anything new? (one request)
node scripts/update-latest.ts --dry-run   # work it out, write nothing
node scripts/update-latest.ts             # update the data files
```

**By hand.** The feed does not carry the Saudi Super Cup, and on a big night it may be slow. The `Add a goal by hand` workflow is a form (it works from the GitHub phone app); `scripts/add-manual-goal.ts` is the same thing on the command line. A goal entered for a match the feed does cover is marked provisional: it steps aside as soon as the feed reports that match, so nothing is counted twice.

**Switches.** The `Match-night controls` workflow (`scripts/control.ts`) can hold or release the goal-1,000 celebration, remove or restore a goal, and count or leave out the disputed goal. Each is a small edit to `data/overrides.json`, checked like any other change.

**Not automatic yet.** Goals are picked up after the match, not during it. Watching a match live, so that goal 1,000 lands within minutes, is the next piece.

`data/source/season.json` is the updater's own record of the season's matches and the next fixtures.

### What counts

A goal counts when the organiser of the competition credits it to him in an official senior match: league, cup and continental games for his clubs, and full internationals for Portugal, friendlies included. Club friendlies, exhibition trophies, youth and B-team games and penalty shoot-out kicks do not count.

### How it was checked

- Club goals match Wikipedia's season-by-season table for every season and competition group.
- All 146 Portugal goals match Wikipedia's list by date and by the score at the time, and the 124 competitive ones match the independent CC0 dataset on the minute.
- 145 of 159 stadium positions agree with their Wikipedia article within 300 metres, and every one lies inside its stated country.

### The one disputed goal

On 23 October 2026 (Al-Faisaly 1–3 Al-Nassr) a goal went in off a defender after Ronaldo challenged for a free kick. The referee's report and the Saudi Pro League credit Ronaldo; Opta and other data providers record an own goal. This dataset follows the competition organiser, as it does everywhere else, so its total is one higher than counts that follow those providers. The goal carries a note saying so, and `countDisputed` in `data/overrides.json` (or the `Match-night controls` workflow) switches it off.

## Sources and credits

- Match facts: ESPN's public match feed (unofficial; only facts are stored).
- Cross-checks: Wikipedia (CC BY-SA 4.0) and [martj42/international_results](https://github.com/martj42/international_results) (CC0).
- Stadium coordinates: Wikidata (CC0) and Wikipedia.
- World outline: Natural Earth (public domain), via `world-atlas`.
- Hologram animation: [Panini America, via GIPHY](https://giphy.com/gifs/SportsManias-world-cup-sportsmanias-panini-muwgatuQcLStmvNZII), played from GIPHY and credited on the page.
- Street-level map tiles: OpenFreeMap, data © OpenStreetMap contributors.
