# ParkHop

Drive to a free park 'n' ride, take the train or bus the rest of the way. ParkHop plans your whole day (school drop-off, work, home), compares park-and-ride with driving and public transport on cost, time and on-time chance, and tells you when to leave.

Built for South East Queensland first. See [DESIGN.md](DESIGN.md) for use cases, design decisions and data sources, and [docs/research.md](docs/research.md) for the research behind them.

## Run

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm test           # engine unit tests (no network)
pnpm smoke          # live end-to-end plan against the real APIs
pnpm build          # installable PWA in dist/
```

The planner needs no API keys. Optional:

- **Assistant:** open Settings, pick a provider, paste a key and tap Save key. Free options: Gemini (aistudio.google.com), Groq (console.groq.com), OpenRouter (openrouter.ai). Paid: Claude. The key stays in your browser and goes only to your ParkHop server, which passes it on and keeps nothing.
  - To set one for everyone using the server instead, put `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` in `.env.local` and restart. A key saved in Settings wins. `ASSISTANT_PROVIDER` forces one server key and `ASSISTANT_MODEL` changes the model.
  - Free limits and model names change, so check each site.
- **Phone preview over Tailscale:** `tailscale serve --bg --https=8443 http://127.0.0.1:5191` with `pnpm dev --port 5191`.

The dev and preview servers cache timetable and road answers in `.cache/`, so a repeat plan is instant and a flaky network does not stop you.

All planning data comes from free public services (Transitous, OSRM, Photon, Open-Meteo, OpenFreeMap). They are fair-use and non-commercial, so read DESIGN.md before shipping anything commercial.

## Refresh the park 'n' ride data

```sh
# 1. Export SEQ park 'n' ride lots from Overpass to overpass.json
#    query: nwr["amenity"="parking"]["park_ride"]["park_ride"!="no"](-28.25,152.55,-26.35,153.6);out center tags;
# 2. Unzip stops.txt from https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip
# 3. Optional: other parking (street, public car parks) from Overpass to other.json
#    query: nwr["amenity"="parking"][!"park_ride"](-27.75,152.6,-27.0,153.3);out center tags;
# 4. Optional: Brisbane City Council parking signs (CC BY 4.0) to signs.json
#    https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/parking-sign-locations/exports/json
python3 -I scripts/build-seq-lots.py overpass.json stops.txt other.json signs.json > src/data/seq-lots.json
```
