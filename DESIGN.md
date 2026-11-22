# ParkHop design

Plan a commute that drives to a free park 'n' ride and takes public transport the rest of the way, and compare it honestly with driving all the way and with public transport only.

Launch region: South East Queensland (Brisbane, TransLink). Research notes with sources: [docs/research.md](docs/research.md).

## Who it is for

| Person | What they need |
| --- | --- |
| Suburban commuter to the CBD | The cheapest way in that still gets them there on time, and a leave-by time they can trust. |
| Parent with a school run | Drop-off by car first, then work. The car must be wherever they need it next. |
| Shift or late worker | A return trip that still has a service, and a lot that is still open. |
| Occasional city visitor | One-off trip: is it worth paying $28 to $49 for CBD parking? |

## Problems with the original idea, and what the app does instead

1. **"Faster than full public transport" is often false.** In live SEQ results for Kallangur to the CBD, public transport only was faster than every park-and-ride option. The app always shows drive-only and transit-only next to park-and-ride, and ranks them honestly. Park-and-ride wins on cost against driving, not always on time.
2. **Lots fill up early.** A free lot is useless at 8:10 if it is full by 7:20. Each lot has a typical "full by" time. The planner turns it into a probability at your arrival time, adds the detour to the nearest backup lot when it is full, and moves your leave-by time earlier if needed. No live occupancy feed exists for SEQ (research section 1), so fill times are estimates, labelled as such, and you can report the real time for your lot.
3. **"Free" time-limited parking is not commuter parking.** 2P street parking near a station does not cover a 9-hour day. Only lots tagged for park 'n' ride are candidates, stays are checked against `maxStayHours`, and stops with a short stay count as drop-offs only.
4. **The car gets stranded.** Park-and-ride in the morning means the car is at the lot in the evening. The planner tracks where the car is through the whole day:
   - The evening leg goes back to that lot ("retrieve").
   - A plan that leaves the car at a lot or at work overnight is rejected.
   - A leg marked "Car" (for example a school pickup) fetches the car first.
5. **Free-flow drive times lie at peak.** The free car router (OSRM) knows no traffic. Times are scaled by a weekday congestion profile that depends on direction (inbound in the morning, outbound in the evening) and rain. It is labelled as an estimate. A live traffic API (TomTom, HERE) plugs into the same interface.
6. **Average times hide risk.** Every option runs a 1,500-day Monte Carlo simulation:
   - Drive times follow a skewed spread that gets wider at peak and in rain.
   - Lots can be full.
   - Missed services mean waiting for the next one, using the real timetable gaps.
   - Vehicles can run late.

   The leave-by time is the latest that is on time on 9 days in 10. You can choose 4 in 5 or 19 in 20 instead. Each option shows its on-time chance and an arrival histogram.
7. **Cost has more parts than fuel.** The daily cost counts fuel, car wear, parking (at the lot and at each stop, hourly or daily, with a cap) and fares. SEQ fares are a flat 50c, so parking is usually the deciding cost. The app shows the yearly difference against driving.

## Features in this build

- Day editor: any number of stops, each with arrive-by, leave-after, stay length and parking cost. Each leg can be set to Best, Car or Transit. Stops can be reordered and removed.
- Place search (Photon), pick on map, two example days.
- Options ranked as Balanced, Cheapest, Fastest or On time. Re-ranking makes no new network calls.
- A trade-off chart of cost against time, option cards with timeline strips, and a detail view with step-by-step legs, lot facts, warnings and an arrival chart.
- Map: all 137 SEQ park 'n' ride lots coloured by how early they fill, plus the selected route by mode.
- Live data where it exists: realtime delays and service alerts that apply to your travel time, and the weather forecast.
- Explains what it rejected, for example "Car would be left at Work overnight" or "Car can't stay at School".
- Hand off to your navigation app: each drive step has Google Maps, Apple Maps and Waze links, and each public transport leg has a Google Maps transit link.
- Installable PWA (phone, tablet, desktop), light and dark themes, keyboard and screen reader support. Data stays on the device.

## Assistant and street parking

- **Assistant:** Gemini, Groq, OpenRouter or Claude Opus 5.5, all with tool use (`set_day`, `plan_options`, `select_option`).
  - The tools run in the browser, so the app visibly changes while Claude works. The server holds the key and adds prompt caching and a refusal fallback.
  - Claude answers only from tool results.
  - Voice input and spoken replies use the Web Speech API.
- **Street parking:** kerbside areas and public car parks within 500 m of a station, from OpenStreetMap. Customer-only, permit and private parking are left out.
  - Inside Brisbane, Brisbane City Council's parking-sign data (52,000 signs, CC BY 4.0) is checked against each kerbside spot. 33 spots near a 2P or shorter limit are dropped, and 2 signed "no limit" are confirmed. 62 kerbside spots and 63 car parks remain.
  - Elsewhere, limits are unknown, so the app says "check the signs".
  - Spots at one station share one timetable query.
  - Parkopedia is commercial, not open data. Notes: [docs/street-parking-research.md](docs/street-parking-research.md).
- **Brisbane tuning:**
  - Paid parking by precinct, used as the default price at each stop.
  - Linkt toll prices. A toll road is chosen only when the minutes saved are worth the toll at your value of time.
  - QLD school terms and public holidays: school holidays lighten the peaks, and public holidays use the weekend profile.
  - Lots that stay full until about 3:45 pm on weekdays and are mostly free at weekends. Afternoon-shift workers hit this.
- **Caching proxy:** timetable and road answers are cached on disk. A future-dated timetable stays fresh for a day and a near-term one for 60 s, and the last good answer is served if the network fails.

## Data sources

| Need | Source | Notes |
| --- | --- | --- |
| Timetables, realtime delays, alerts | Transitous (MOTIS 2), TransLink GTFS and GTFS-RT | Keyless, CORS open. Non-commercial, about 720 plans a day is their concern level. |
| Car routes | OSRM public demo | Free-flow only, fair use, no SLA. |
| Traffic | Built-in weekday congestion profile | TomTom has the best free tier (20K requests a month) for a live upgrade. |
| Park 'n' ride lots | OpenStreetMap `park_ride` (snapshot) plus TransLink GTFS stations | 137 SEQ lots. Capacity is known for about a third of them. Rebuild with `scripts/build-seq-lots.py`. |
| Fill times | Estimate from capacity and distance to the CBD, plus commuter reports | No public SEQ occupancy feed exists. The NSW Car Park API is the model for adding one. |
| Fares | 50c flat, set in law in 2026 (research section 1) | SEQ GTFS has no fare files. |
| CBD parking | BCC King George Square early bird, $28 | Editable for each stop. |
| Weather | Open-Meteo | Hourly rain and temperature, 16 days ahead. |
| Geocoding | Photon (OpenStreetMap) | |
| Map tiles | OpenFreeMap (Positron, Dark) | |

## Architecture

- `src/engine`: pure TypeScript with no UI or network code, unit-tested.
  - `planner.ts` builds every feasible day by searching over where the car is. Car location is the search state.
  - `simulate.ts` gives the on-time odds.
  - `traffic.ts`, `parking.ts`, `geo.ts`, `time.ts`: timezone-safe helpers.
- `src/providers`: one adapter per data source behind small interfaces (`DriveProvider`, `TransitProvider`, `WeatherProvider`, `GeocodeProvider`). Requests are memoised, rate-limited and retried. To change provider, write a new adapter.
- `src/data/seq.ts`: region config (timezone, CBD radius, fares, lots, presets). A new city is a new data file.
- `src/ui` and `src/state`: React 19 and Zustand, MapLibre GL 6.

## Known limits and next steps

- **Commercial use** needs paid or self-hosted routing. Transitous, the OSRM demo, Open-Meteo free and Overpass all exclude it. Self-hosting OpenTripPlanner 2 with SEQ GTFS gives native `car-to-park` routing and live GTFS-RT under our own control.
- **Speed:** a fresh plan makes about 20 timetable requests and takes 15 to 40 s on the public server. Replans reuse the cache. A small backend that batches and caches would bring this under 5 s.
- **Live lot occupancy:** push TMR to publish it, or collect crowd reports (the "found it full at" control is the start of this).
- **Departure alerts:** a push reminder at leave-by time, with "leave 5 min earlier, train delayed". This needs a backend for push.
- **More modes:** bike and ride, kiss and ride, and paid lots with booking.
- **Weekly view:** plan a different day pattern for each weekday, with weekly totals.
