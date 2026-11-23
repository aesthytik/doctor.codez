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
```

Node 22 or newer. The scripts are TypeScript run directly by Node; they need no build step.

Useful addresses while developing:

| Address | What it shows |
|---|---|
| `/?preview=1000` | The goal-1,000 celebration, rehearsed with simulated goals (clearly labelled) |
| `/?intro=0` | Skip the opening |
| `/?venue=santiago-bernabeu` | Open straight onto one stadium |
| `/?goal=700` | Open straight onto one goal |
| `/?t=2012-06-01` | The career as it stood on a date |

## How it works

- `components/globe/` draws the Earth with MapLibre GL (globe projection) from a world outline shipped with the site, and the lights with deck.gl. Street-level tiles are requested from OpenFreeMap only after someone zooms in, so the opening view and the celebration depend on no outside service.
- `components/Experience.tsx` holds the interface state: the timeline, the stadium and goal on show, and the celebration.
- `lib/data/` turns the dataset into what is drawn: per-stadium totals, each goal's place in its stadium's spiral, and the clock behind the timeline.

## The dataset

`data/goals.json` holds one record per goal and is always built by script, never edited by hand. `data/venues.json` holds one record per stadium and is curated by hand; the validator checks it.

| File | What it is |
|---|---|
| `data/source/espn-goals.json` | Facts swept from ESPN's public match feed: who scored, when, where |
| `data/manual-goals.json` | Goals the feed does not carry, entered by hand with their sources |
| `data/overrides.json` | The counting rule, neutral-ground rulings and other hand corrections, each with its reason |
| `data/venues.json` | Curated stadiums with coordinates |
| `data/reference/` | Published totals and lists used only to cross-check |

```bash
pnpm sweep                      # re-read the feed (cached; slow the first time)
pnpm data                       # rebuild data/goals.json from the sources above
pnpm validate                   # numbering, running scores, totals and stadium positions
node scripts/geocode-venues.ts  # propose coordinates for new stadiums
```

### Adding a new goal by hand

Until the automatic updater is in place, three commands bring the dataset up to date after a match:

```bash
node scripts/build-history.ts --only=alnassr   # re-read this season from the feed
pnpm data                                      # rebuild data/goals.json
pnpm validate                                  # confirm it is sound
```

The feed does not carry the Saudi Super Cup. A goal there goes into `data/manual-goals.json` with its source.

### What counts

A goal counts when the organiser of the competition credits it to him in an official senior match: league, cup and continental games for his clubs, and full internationals for Portugal, friendlies included. Club friendlies, exhibition trophies, youth and B-team games and penalty shoot-out kicks do not count.

### How it was checked

- Club goals match Wikipedia's season-by-season table for every season and competition group.
- All 146 Portugal goals match Wikipedia's list by date and by the score at the time, and the 124 competitive ones match the independent CC0 dataset on the minute.
- 145 of 159 stadium positions agree with their Wikipedia article within 300 metres, and every one lies inside its stated country.

### The one disputed goal

On 23 October 2026 (Al-Faisaly 1–3 Al-Nassr) a goal went in off a defender after Ronaldo challenged for a free kick. The referee's report and the Saudi Pro League credit Ronaldo; Opta and other data providers record an own goal. This dataset follows the competition organiser, as it does everywhere else, so its total is one higher than counts that follow those providers. The goal carries a note saying so, and `countDisputed` in `data/overrides.json` switches it off.

## Sources and credits

- Match facts: ESPN's public match feed (unofficial; only facts are stored).
- Cross-checks: Wikipedia (CC BY-SA 4.0) and [martj42/international_results](https://github.com/martj42/international_results) (CC0).
- Stadium coordinates: Wikidata (CC0) and Wikipedia.
- World outline: Natural Earth (public domain), via `world-atlas`.
- Street-level map tiles: OpenFreeMap, data © OpenStreetMap contributors.
