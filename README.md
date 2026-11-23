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

## The dataset

`data/goals.json` holds one record per goal and `data/venues.json` one per stadium. Both are built and checked by scripts, never edited as output.

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
