# ParkHop

Drive to a free park 'n' ride, take the train or bus the rest of the way. ParkHop plans your whole day (school drop-off, work, home), compares park-and-ride with driving and public transport on cost, time and on-time chance, and tells you when to leave.

Built for South East Queensland first. See [DESIGN.md](DESIGN.md) for use cases, design decisions and data sources, and [docs/research.md](docs/research.md) for the research behind them.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (no network)
npm run smoke      # live end-to-end plan against the real APIs
npm run build      # installable PWA in dist/
```

No API keys needed. All data comes from free public services (Transitous, OSRM, Photon, Open-Meteo, OpenFreeMap). They are fair-use and non-commercial, so read DESIGN.md before shipping anything commercial.

## Refresh the park 'n' ride data

```sh
# 1. Export SEQ park 'n' ride lots from Overpass to overpass.json
#    query: nwr["amenity"="parking"]["park_ride"]["park_ride"!="no"](-28.25,152.55,-26.35,153.6);out center tags;
# 2. Unzip stops.txt from https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip
python3 -I scripts/build-seq-lots.py overpass.json stops.txt > src/data/seq-lots.json
```
