# ParkHop research: data sources and real-world facts

Compiled 2026-11-21. Region: South East Queensland (SEQ), generalised worldwide.

Legend for confidence:
- **[V]** verified by me this session (fetched the page or ran the request).
- **[S]** from a search-tool summary only, not fetched. Re-check before relying on it.
- **[U]** unverified or could not be determined.

---

## 0. Headline findings

1. **Transitous accepts `preTransitModes=CAR_PARKING` in SEQ and returns car, walk, transit itineraries with realtime delays [V].** But the API schema has no parking metadata (no fee, capacity, name, occupancy) [V], the parking spot chosen is unnamed, and what kind of parking it picks is **[U]**. The app must supply P&R knowledge itself (OSM + TransLink list) and treat Transitous as one routing engine, not the P&R brain.
2. **No live P&R occupancy feed exists for SEQ [V as far as public sources go].** TMR closed an open-data request for P&R data with "to be released as open data at a later date". TMR only runs annual utilisation audits. Brisbane's two council CBD car parks do have a live vacancy dataset, but it is flagged broken by the council. The closest live-occupancy example in Australia is the NSW Car Park API.
3. **Keyless does not mean browser-usable.** TransLink GTFS static and GTFS-RT are keyless but send no CORS headers [V], so they need a proxy (and protobuf decoding, 1.1 MB for TripUpdates). Browser-usable keyless: Transitous, Open-Meteo, Photon, OpenFreeMap, OSRM demo, Valhalla demo (FOSSGIS), Brisbane open data (Opendatasoft), QLD CKAN. QLDTraffic needs a key and CORS is **[U]**.
4. **Commercial use is the cross-cutting constraint.** Transitous, OSRM demo, Open-Meteo free tier, GraphHopper free plan and the main Overpass server all exclude or discourage commercial use. Transitous also expects an open-source app and wants contact if above about 720 `/plan` calls/day.
5. **50 cent TransLink fares are permanent and now in law [V]** (Act assented mid 2026), except the Airport rail link. The SEQ GTFS zip has no fare files [V], so hard-code fare logic.
6. **OSM has about 240 `park_ride=yes|bus|train` lots in SEQ, all `fee=no`, but only about a third have `capacity`** [V, bbox below]. Time limits and opening hours are almost absent.
7. **TransLink's own rule is "first until last service" parking, no overnight, unmoved vehicles for days may be treated as abandoned [V].** Early-bird CBD parking is windowed (e.g. enter 5:30 to 7am, exit 1pm to 6pm).

---

## 1. SEQ / Brisbane specifics

### 1.1 TransLink GTFS static and realtime

| Item | Finding | Source |
|---|---|---|
| GTFS static (SEQ) | `https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip`. HTTP 200 keyless. 40 MB zip, about 298 MB unzipped (stop_times 242 MB). Updated daily (last-modified Fri 20 Nov 2026 20:22 GMT). Feed validity 2026-11-21 to 2027-01-20. [V] | https://www.data.qld.gov.au/dataset/general-transit-feed-specification-gtfs-translink |
| Files in zip | agency, calendar, calendar_dates, feed_info, routes, shapes, stops, stop_times, trips. **No fare_attributes, fare_rules, or Fares v2 files. No transfers.txt, no parking info.** 13,125 stops. [V] | same |
| Licence | CC BY 4.0 [V] | https://www.data.qld.gov.au/api/3/action/package_show?id=general-transit-feed-specification-gtfs-translink |
| Terms | Open data terms and conditions apply. Realtime must be used with the schedule. [V] | https://www.translink.com.au/about-translink/open-data |
| GTFS-RT trip updates | `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates` (protobuf, about 1.1 MB). Keyless, 200. [V] | open-data page above |
| GTFS-RT vehicle positions | `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions` (about 100 KB). Keyless. [V] | same |
| GTFS-RT alerts | `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/alerts` (about 30 KB). Keyless. [V] | same |
| Per mode | Bus/rail/tram/ferry sub-paths under `/SEQ/TripUpdates/` and `/SEQ/VehiclePositions/` (per the open-data page) [S-level: read from page, not requested] | same |
| Format | GTFS-realtime v2.0, protobuf | same |
| CORS | **No `Access-Control-Allow-Origin` header on RT or GTFS zip; OPTIONS returns 405.** Needs a server proxy. [V] | my curl tests |
| Other regions | Cairns RT also exists; other regional feeds are static only | open-data page |

Parking in GTFS: only bus P&R stops are named "... park 'n' ride stop A/B" (e.g. Park Ridge, Slacks Creek). Train station car parks are not in GTFS. [V from stops.txt]

### 1.2 Park 'n' ride facilities as data

| Item | Finding | Source |
|---|---|---|
| TransLink list | Web page with map and list ("approximate number of spaces"), **JS-rendered, no download link found** [V] | https://translink.com.au/travel-with-us/parking |
| QLD open data portal | Searches for park n ride return no P&R facility dataset [V] | https://www.data.qld.gov.au/api/3/action/package_search |
| Open data request | TMR staff asked for P&R location, capacity, real-time occupancy and a KML. Closed with "To be released as open data at a later date". Not confirmed published. [V] | https://www.data.qld.gov.au/datarequest/2465016b-78fc-4145-8283-66fd75437142 |
| Network size | **158 facilities** (2019 parliamentary answer) [V]. **More than 31,500 spaces, about 4,400 added since 2015** in TMR Park 'n' Ride Strategy summary [V, read from PDF] | https://documents.parliament.qld.gov.au/tableoffice/questionsanswers/2019/338-2019.pdf ; https://www.tmr.qld.gov.au/-/media/aboutus/corpinfo/Publications/Park-n-Ride-Strategy-summary.pdf |
| Rules | "A vehicle may be parked at a park 'n' ride from first until last service." Vehicles unmoved "for an extended period of days" may be treated as abandoned. Train station car parks are run by Queensland Rail; some bus and ferry terminal car parks by Brisbane City Council. Page does not state free/paid. [V] | https://mobile.translink.com.au/travel-with-us/parking |
| Free vs paid | OSM tags all SEQ P&R lots `fee=no` (see 2.4). Official free/paid statement not found. [U] | |
| Time limits | None stated beyond "first until last service" | |
| Recent upgrades | Queensland Rail list with space counts: Cannon Hill 80, Carseldine 200, Coomera 500+, Darra 180, Ebbw Vale 70, Geebung 70, Lawnton 250, Mango Hill 280, Murarrie 132, Ormeau 125, Springfield Central 1,100 (precinct), Varsity Lakes 350, Virginia 50; Narangba 100+ under construction; Salisbury 140 (stage 1) [V] | https://queenslandrail.com.au/inthecommunity/projects/park-n-ride-program |
| Gold Coast | Helensvale about 400 spaces in one source, 1,285 total after upgrades per 2020 answer; Parkwood up to 1,000. No occupancy feed found [S] | https://documents.parliament.qld.gov.au/tableoffice/questionsanswers/2020/814-2020.pdf |

### 1.3 Live occupancy in SEQ

| Operator | Live P&R occupancy? | Evidence |
|---|---|---|
| TMR / TransLink / QR | **None found.** TMR runs annual utilisation audits (single-day counts, e.g. Varsity Lakes: 392 vehicles in 2017, 486 in 2018). TransLink head quoted as wanting to tell customers where car parks are full (aim, not product) [S] | 2019 answer above; https://www.inkl.com/news/commuters-frustrated-by-lack-of-park-and-ride-spaces-fuelling-safety-fears [S, 403 on fetch] |
| Brisbane City Council | Live vacancy for **2 CBD car parks only** (King George Square, Wickham Terrace), updated each minute, **but the dataset notes vacancy numbers are not changing and a fix is pending** [V]. API returned `king_george_square: 233, wickham_terrace: 320` and stayed CORS-open | https://data.brisbane.qld.gov.au/explore/dataset/brisbane-parking-stations |
| Gold Coast / Sunshine Coast | Nothing found [S] | |
| Reference example | Transport for NSW **Car Park API**: real-time and historical occupancy for selected Park&Ride lots, mapped to stop IDs; update frequency 60 s for the lots in the v2.2 doc (some "Historical Only"); recommends showing "Full" when < 1 space, "Almost Full" under 10%, with "~" to flag estimates. Needs a free TfNSW API key (**[U]**, endpoint not confirmed this session). Doc: v2.2. Licence listed as CC BY on data.nsw.gov.au (one mirror says unspecified). | https://opendata.transport.nsw.gov.au/dataset/car-park-api ; doc PDF https://opendata.transport.nsw.gov.au/data/dataset/543cbdf4-9b52-4013-8ddb-8721a33bda97/resource/1cd0b16d-d9f8-4973-93cd-3c6f66a3e99c/download/car-park-api-documentation-v2.2.pdf |

Design implication: show P&R "fullness" as a **user-reported or time-of-day heuristic**, clearly labelled estimated, until TMR publishes data.

### 1.4 Which lots fill early

Evidence is thin and mostly anecdotal. Nothing official gives a per-lot fill time.

- ABC Radio Brisbane callers (via inkl, date not shown): Windsor and a Carseldine lot "full by 7am" [S, 403 on fetch].
- 2018 parliamentary speech: Ormeau main car park "full early in the morning" (since upgraded by 125 spaces) [S]: https://documents.parliament.qld.gov.au/speeches/spk2018/Michael_Crandon-Coomera-20180306-212108951532.pdf
- Pre-launch government modelling for 50c fares warned of "impact on the availability of parking at certain stations, park 'n' ride facilities and bus interchanges" [S]: https://statements.qld.gov.au/statements/101015
- Weekend Notes pre-launch: P&Rs "likely to fill up earlier", Chermside line named [S]
- Minister, April 2026: "Demand for these facilities remains high across South East Queensland" [V]: https://documents.parliament.qld.gov.au/tableoffice/questionsanswers/2026/357-2026.pdf
- Patronage growth since 50c fares vs 2023 benchmark: rail +18.6%, bus +15.8%, light rail +27.5%, ferry +42.8% (government figures) [S]: https://statements.qld.gov.au/statements/101980
- Not found: any lot-by-lot time-to-full. Treat "about 7am" as an unverified rule of thumb, applicable to some inner-north and western lots.

### 1.5 TransLink fares

| Item | Finding | Source |
|---|---|---|
| Flat fare | **50 cents per trip regardless of distance, SEQ-wide** (bus, train, tram, ferry) [V] | search summary of TransLink site; law below |
| Status | Trial started 5 Aug 2024; permanent from Feb 2025 [S] https://statements.qld.gov.au/statements/101980 | |
| In law | Revenue (Cost of Living Relief Locked-in Law) and Other Legislation Amendment Act 2026 (No. 16). New s 10A: chief executive must ensure fares are not more than 50 cents for road-based general route services, regional centre services, **SEQ rail network**, Gold Coast light rail, ferries, non-free Brisbane river ferries. **Excludes the Brisbane Airport rail link**. [V, read the Act] Reported passed 26 June 2026 [S] | https://www.legislation.qld.gov.au/view/whole/html/asmade/act-2026-016 |
| Late-2026 change? | None found in my searches. [U, absence of evidence] | |
| Implication | Transit fare is a constant 0.50 per leg, so cost comparison is dominated by parking, fuel, tolls. Do not model zones for SEQ, but do model them for other cities (Fares v2). | |

### 1.6 Brisbane parking prices

| Facility | Price | Source |
|---|---|---|
| BCC King George Square car park | Early bird **$28** (enter 5:30am to 7am, exit 1pm to 6pm). Weekday daily max **$49** if out before 6pm, $64 overnight. 0 to 15 min free; 30 to 60 min $24; 4+ h $49. Weekend max $20. Hours Mon to Thu 5:30am to midnight. [V] | https://www.brisbane.qld.gov.au/traffic-and-transport/parking-in-brisbane/car-parks/king-george-square-car-park |
| BCC Wickham Terrace | Early bird **$26** (enter 5:30am to 9am, exit 1pm to 7pm). Daily max $49 (before 6pm). Weekend flat $6. 24 h. [V] | same page |
| Wilson Parking | 145 Ann St listed daily max $80; 200 Mary St "Early Bird no longer available" [S] | https://wilsonparking.com.au/park/4121_145-Ann-Street-King-George-Central_145-Ann-Street-Brisbane |
| Secure Parking / Care Park | No 2026 rate found. [U] A blog reports Secure-A-Spot booking saves at least 10% [S] | https://www.motorama.com.au/blog/motoring-tips/finding-the-best-cheap-car-parking-in-brisbane |
| Aggregator | Early-bird deals around $30/day reported after 50c fares [S] | https://adventuresintransitland.substack.com/p/fares-fair-in-the-sunshine-state |

Rule of thumb for the app: CBD all-day parking is about $26 to $49 council, up to about $80 private; P&R is $0 with 50c fare. Prices are per-operator and must be user-editable.

### 1.7 Brisbane on-street parking open data

Brisbane City Council uses Opendatasoft (`https://data.brisbane.qld.gov.au/api/explore/v2.1/...`), CC BY 4.0, CORS `*` [V]. Mirrored in QLD CKAN.

| Dataset | Content | Notes |
|---|---|---|
| `brisbane-parking-meters` | 945 meter zones: `meter_no`, street, suburb, `max_stay_hrs`, restrictions, `operational_day/time`, `tar_rate_weekday`, `tar_rate_ah_we`, lat/lon, `mobile_zone`. Example: Bowen Hills, 3 h max, $6.85, "Zone 1, 15 min free" [V] | https://data.brisbane.qld.gov.au/explore/dataset/brisbane-parking-meters |
| `parking-occupancy-forecasting` | ML **forecast** (not live) of paid-zone occupancy by `mobile_zone`, `date`, `hour`; 4.1M rows [V] | https://data.brisbane.qld.gov.au/explore/dataset/parking-occupancy-forecasting |
| `brisbane-parking-stations` | Live-ish vacancy for 2 council car parks, flagged as incorrect [V] | link above |
| `parking-regulated-permit-parking-areas` | Resident permit zones [V listed] | https://www.data.qld.gov.au/dataset/parking-regulated-permit-parking-areas |
| `parking-sign-locations`, `parking-line-locations`, `parking-clearways`, `disability-permit-parking-locations` | Signs, kerb lines, clearways [V listed] | QLD CKAN search |

Council rules: 2P means up to 2 hours; resident permit holders exempt where signed "Resident permit excepted"; permits do not guarantee a space [S]: https://www.brisbane.qld.gov.au/traffic-and-transport/parking-in-brisbane/parking-rules

### 1.8 QLDTraffic (TMR traffic API)

| Item | Finding |
|---|---|
| Spec | v1.10 (19 Feb 2025), CC BY 4.0 AU [V]: https://qldtraffic.qld.gov.au/media/moreDevelopers-and-Data/qldtraffic-website-api-specification-v1-10.pdf |
| Base URLs | `https://api.qldtraffic.qld.gov.au/v1/` ; `/v2/` for events [V] |
| Endpoints | `/v2/events` (incidents, roadworks, congestion, special events, flooding), `/v2/events/past-one-hour`, `/v1/webcams`, `/v1/floodcams`, `/v1/highriskcrashzones` (noted as no longer existing) [V] |
| Key | **Required**, query param `apikey`. A shared public key is printed in the spec but is globally limited to 100 requests/min. In my two tests it returned **HTTP 429 LimitExceeded** [V]. A unique key is obtained by emailing the API administrator [V]. |
| CORS | Not determined (429 response showed none) [U] |
| Travel times / speeds | **None.** Events only. No link-level speed or travel-time feed in the API [V from spec] |
| Rate limit | 429 on exceed; 403 on bad key [V] |
| Free congestion data | None found in SEQ. For traffic-aware ETAs use TomTom/HERE/Google/Mapbox (see 2.2). |

### 1.9 Fuel and tolls

| Item | Finding | Source |
|---|---|---|
| QLD fuel prices (live) | Fuel Price Reporting scheme; sign up at fuelpricesqld.com.au, accept terms, receive security tokens by email. Technical docs behind sign-up. A community post shows `Authorization: FPDAPI SubscriberToken=...` against `fppdirectapi-prod.fuelpricesqld.com.au` (third party, unverified) [S]. Cost and licence not stated publicly. | https://www.treasury.qld.gov.au/research-and-publications/fuel-price-data/ [V] |
| Fuel history | Monthly CSVs, CC BY 4.0, dataset `fuel-price-reporting-2026` on data.qld.gov.au [V] | same |
| Contact | fuelprices@treasury.qld.gov.au [V] | same |
| Tolls (cars, from 1 Jul 2026, GST incl) | Clem7 $6.77; Go Between Bridge $4.22; Legacy Way $7.30; Gateway Motorway Murarrie $6.02, Kuraby/Compton Rd $3.55, Loganlea $2.28, Heathwood/Paradise Rd $3.76. Airport Link price unchanged, no car price on the page. [V] | https://www.linkt.com.au/using-toll-roads/news/toll-and-fee-changes-1-july-2026 |
| Toll data feed | No public API found. Prices change each 1 July by CPI [S]. Hard-code with a date stamp. | https://www.linkt.com.au/using-toll-roads/about-brisbane-toll-roads/toll-pricing |

---

## 2. Global and generic sources

### 2.0 Quick matrix (keyless and browser use)

| Source | Key? | Browser CORS [V unless noted] | Commercial OK? |
|---|---|---|---|
| Transitous (MOTIS 2) | No (UA/Referer contact required) | Yes (`*`) | **No** |
| Photon (komoot) | No | Yes | Unstated, "be fair", throttling |
| Nominatim (OSM) | No | Yes | Allowed with limits, 1 req/s, **no autocomplete** |
| Open-Meteo free | No | Yes | **Non-commercial only** |
| OpenFreeMap | No | Yes (style JSON `*`) | Terms silent on commercial; "as-is" |
| OSRM demo | No | Yes | **Non-commercial** |
| Valhalla FOSSGIS demo | No | Yes | Fair-use, notify maintainers for apps |
| Overpass main | No | **[U]** (my test timed out/502) | **Self-host or pay for commercial** |
| TransLink GTFS/RT | No | **No CORS** | CC BY 4.0 |
| QLDTraffic | Yes | **[U]** | CC BY 4.0 AU |
| BCC / QLD open data | No | Yes (`*`) | CC BY 4.0 |
| Google Routes, HERE, TomTom, Mapbox, GraphHopper, Navitia, Transitland | Yes | Mostly yes with key (restrict key by referrer) | Paid tiers |

### 2.1 Transitous (api.transitous.org, MOTIS 2)

| Question | Finding |
|---|---|
| Base URL | `https://api.transitous.org/api/` (v1 plan, geocode, etc.). Server header `MOTIS v2.11.4` [V] |
| Endpoints | `/api/v1/plan` (routing), `/api/v1/geocode`, `/api/v1/reverse-geocode`, `/api/v1/rentals`, plus stoptimes/trip/one-to-many/one-to-all [V some, rest per docs] |
| Plan params relevant | `fromPlace`, `toPlace` (`lat,lon`), `time`, `preTransitModes`, `postTransitModes`, `directModes`, `transitModes`, `maxPreTransitTime`, `maxDirectTime`, `requireCarTransport`, `numItineraries`, `useRoutedTransfers`, `slowDirect` [V in OpenAPI] |
| Mode enum | `WALK, BIKE, RENTAL, CAR, HGV, CAR_PARKING, CAR_DROPOFF, ODM, RIDE_SHARING, FLEX` (street) and transit modes [V]. `CAR_PARKING` and `CAR_DROPOFF` are marked **"Experimental. Expect unannounced breaking changes"** [V] |
| Enabled on public instance? | **Yes.** `preTransitModes=CAR_PARKING&directModes=CAR` returned 200 with itineraries; debug output shows `prepare_forward_CAR_PARKING` [V] |
| SEQ coverage | **Yes.** Feed config `feeds/au-qld.json` includes Translink-SEQ static plus `~rt` realtime [V]: https://raw.githubusercontent.com/public-transport/transitous/main/feeds/au-qld.json |
| Realtime in SEQ | **Yes.** A "now" query returned `realTime: true` on bus and rail legs with delays (e.g. scheduled 22:38Z, actual 22:35Z). Itineraries a day ahead show `realTime:false` as expected [V] |
| Sample result | Origin Annerley-ish (-27.5598,152.9722) to CBD (-27.4698,153.0251), Mon 7:00 AEST: 36 to 41 min itineraries, shape CAR (7 to 10 min) then WALK then RAIL/BUS then WALK. Drives to Chelmer or near Annerley Junction, walks from an unnamed point to the stop [V] |
| Pitfall: what parking? | CAR leg ends at an **unnamed point** (`name: ""`). OpenAPI has no parking name, fee, capacity or occupancy fields [V]. Whether MOTIS picks only P&R-tagged lots or any `amenity=parking` is **[U]** (could not query Overpass to check; it was returning 502). **Test before trusting.** Post-filter against own P&R list. |
| Pitfall: plain `CAR` pre-transit | `preTransitModes=CAR` gives unrealistic 23 to 24 min itineraries (car drives straight to the stop, no parking or walk) [V] |
| Fares | Response has no fare data (`fares: 0` in debug) [V] |
| Usage policy | Open-source, non-commercial, light-weight projects only. **Commercial use not allowed.** Send own `User-Agent` with app name, version, contact (browser apps: `Referer` is accepted). Generic UAs (e.g. `Python-urllib`) get a message and are blocked [V]. No hard rate limit published; **concern threshold about 720 requests per 24 h to `/plan`, `/one-to-many`, `/one-to-all`**. Contact them (Matrix) before launch if heavy. Best-effort volunteer service. Link to sources page, follow OSM attribution. Staging instance not for apps [V] https://transitous.org/api/ |
| CORS | `access-control-allow-origin: *` [V] |

### 2.2 Routing engines

| Engine | Park-and-ride? | Traffic-aware? | Cost / key / terms | Source |
|---|---|---|---|---|
| **OpenTripPlanner 2** | **Yes**, `car-to-park` street mode. Parking options: `cost` (default 120), `time` (PT1M), tag filters (required/banned/preferred). `car-to-park` gets default penalty `20m + 2.0 t` and cost factor 1.5. `parkAndRideDurationRatio` filters trips where driving is a trivial share. Parking from OSM or realtime feed. [V] | No live traffic by default | Self-host, open source | https://docs.opentripplanner.org/en/latest/RouteRequest/ |
| **Navitia** | `park_mode` values `none, on_street, park_and_ride` documented (wording is bike-focused); `car` valid in `first_section_mode[]`. Car routing via Valhalla. [V] | Not stated | Key issued at registration; pricing via sales contact; no free tier stated [V] | https://doc.navitia.io/ |
| **HERE Intermodal Routing v8** | **Yes.** Park and Ride request: `vehicle[modes]=car`, `vehicle[enable]=routeHead`, `transit[enable]=routeTail`. Not enabled by default. [S] | Via HERE traffic | Key; one transaction per returned alternative; free tier allocation not confirmed [S]. Docs: https://docs.here.com/transit/docs/send-request-1-intermodal | |
| **Google Routes API** | **No park-and-ride mode documented.** `TRANSIT` travel mode exists; docs state transit requests cannot specify traffic inclusion. Pricing: Compute Routes Essentials $5/1k (10k free/mo), Pro $10/1k (5k free), Enterprise $15/1k (1k free) [V]. Which request features trigger Pro vs Enterprise not confirmed [U]. | Driving: yes (traffic-aware options); transit: no | Key, billing account | https://developers.google.com/maps/documentation/routes/transit-route ; https://developers.google.com/maps/billing-and-pricing/pricing |
| **TomTom Routing** | No park-and-ride | Yes (live traffic) | Key; free: 20K Routing requests/month, Traffic Incidents Details 2.5K/mo, traffic tiles 200K/mo; per-1k price not on page; commercial-on-free not stated [V] | https://docs.tomtom.com/pricing |
| **Mapbox Directions** | No transit profile. Profiles: `driving-traffic` (live+historic), `driving`, `walking`, `cycling` [V]. About 100k free requests/mo then about $2/1k [S, aggregator, verify] | `driving-traffic` yes | Key | https://docs.mapbox.com/api/navigation/directions/ |
| **OSRM demo** | Car, foot, bike only | No | 1 req/s max, "reasonable non-commercial use", no uptime guarantee [V] | https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server |
| **Valhalla (FOSSGIS demo)** | Routing only | No | "Fair-use like OSRM/Nominatim demo"; asks apps to notify via GitHub Discussions and send `X-Client-Id` header [V]. CORS `*` [V] | https://github.com/valhalla/valhalla |
| **GraphHopper** | Routing only | Not stated | Free plan: 500 credits/day, max 5 locations, 1 vehicle, **non-commercial only** [V] | https://www.graphhopper.com/pricing/ |

Takeaway: for the "drive then transit" leg with real traffic, combine (a) a transit engine for the transit part (Transitous/OTP/Navitia/HERE), (b) a traffic-aware driving ETA from a keyed provider (TomTom 20k free/mo is the most generous verified) or a time-of-day multiplier.

### 2.3 Parking data

| Source | What | Access | Notes |
|---|---|---|---|
| **OSM tags** | `amenity=parking`, `park_ride=yes/no/bus/train/tram/ferry/metro/mobility_hub/hov` (nodes and areas, **not ways** per wiki), `fee`, `maxstay`, `capacity`, `opening_hours`, `access` [V] | Free, ODbL | A station car park is not P&R unless signed as such. `maxstay` format `2 hours`, with `maxstay:conditional=... @ (...)`. https://wiki.openstreetmap.org/wiki/Key:park_ride ; https://wiki.openstreetmap.org/wiki/Key:maxstay |
| **OSM coverage in SEQ (measured)** | Overpass query `nwr["amenity"="parking"]["park_ride"]` in bbox (-27.75,152.6,-27.2,153.3) (Brisbane to Ipswich to Logan, **excludes Gold Coast and Sunshine Coast**): 382 elements; 237 `yes`, 142 explicit `no`, 2 `bus`, 1 `train`. Of the 240 positive: `fee` 238 (**all `no`**), `capacity` 77 (32%), `maxstay` 4 (all "2 minutes" kiss-and-ride bays), `opening_hours` ~0, `name` 237, `operator` 219. [V] | | Wider bbox re-run failed (Overpass 502). |
| **Overpass API** | Query OSM live | Main instance: max 10,000 queries/day, wait 30 s after 429/406, identify app with UA or Referer, **commercial use should self-host or pay**. Alternatives listed (private.coffee no limit, overpass.ch 10k/mo free). A request **without a User-Agent returned 406** [V]. CORS **[U]** | https://wiki.openstreetmap.org/wiki/Overpass_API |
| **Parkopedia** | Static (off-street and on-street, spaces, prices, hours, EV) and dynamic (occupancy, probability to find parking). Via API or feed, **sales-gated** [S]. Australian coverage **[U]** | Commercial | https://business.parkopedia.com/data |
| **SpotHero** | Facilities, rates, availability, reservations API (`api.spothero.com/v2`), partner-gated, North America focus; Canada and non-US coverage **[U]** [S] | Partner only | https://spothero.com/developers |
| **TomTom Parking API** | Off-street availability (refreshed about every 10 min) and price estimates; availability API **not on freemium/PAYG** [S] | Paid | https://docs.tomtom.com/parking-availability-api/documentation/product-information/introduction |
| **HERE On-Street Parking** | Availability level, probability [S] | Paid | https://docs.here.com/parking/docs/readme-summary |
| **DATEX II / NDW (NL)** | DATEX II parking publications (CEN/TS 16157-6). NL national parking data goes via RDW SPDP web API (separate standard) and municipal portals (Amsterdam P&R utilisation). Whether NDW itself publishes P&R occupancy **[U]** [S] | Open | https://npropendata.rdw.nl/ |
| **TfNSW Car Park API** | See 1.3. Best example of live P&R occupancy | Free key (**[U]**) | doc v2.2 |
| **BCC parking datasets** | See 1.7 | Open | |

### 2.4 Fares and feed catalogues

| Source | What | Notes |
|---|---|---|
| **GTFS Fares v2** | Files `fare_products, fare_media, rider_categories, fare_leg_rules, fare_transfer_rules, networks, route_networks, areas, stop_areas, timeframes`. Community-evolving. **Nothing about parking or P&R fares** [V] | https://gtfs.org/documentation/schedule/examples/fares-v2/ . SEQ feed does not publish it (see 1.1). |
| **Transitland** | REST API keyed (`apikey` param or header). Free tier "relatively low rate limit"; GraphQL needs paid plan; RT feed downloads count against REST quota. Exact numbers **[U]** [S]. Transitous sources its SEQ feeds from Transitland Atlas IDs [V] | https://www.transit.land/documentation/rest-api/ (403 on fetch) |
| **Mobility Database** | Catalogue of GTFS, GTFS-RT, GBFS feeds, 6,000+ feeds in 100+ countries, REST API with sign-up. Licence and whether SEQ is listed **[U]** [V page read] | https://mobilitydatabase.org/ |

### 2.5 Weather, geocoding, tiles

| Source | Finding | Source |
|---|---|---|
| **Open-Meteo** | Keyless, CORS `*` [V]. Free API **non-commercial only** (no ads or subscriptions). Limits **600/min, 5,000/h, 10,000/day, 300,000/month** per IP/app. Requires CC BY 4.0 attribution. Paid tiers for commercial. [V] | https://open-meteo.com/en/terms |
| **Photon (komoot)** | `https://photon.komoot.io/api/?q=...`, keyless, CORS `*` [V]. "Be fair", extensive usage throttled, no availability guarantee. Supports typeahead. [V] | https://photon.komoot.io/ |
| **Nominatim** | Max **1 req/s**, valid UA or Referer, **autocomplete forbidden**, cache results, no systematic grid queries. CORS `*` [V] | https://operations.osmfoundation.org/policies/nominatim/ |
| **Transitous geocode** | `/api/v1/geocode?text=...` returns stops and places, includes SEQ stops by name, e.g. "Chelmer station" with modes [V] | |
| **OpenFreeMap** | Style URLs e.g. `https://tiles.openfreemap.org/styles/liberty` (also positron, bright, dark, fiord, 3D), no key, CORS `*` [V]. ToS: "completely free, as-is"; limits stated only for offline downloads (3,000 tiles or 50 MB, 4 parallel, unique UA). Commercial and attribution not addressed in ToS; sample map shows "OpenMapTiles" and "OpenStreetMap" credits. [V] | https://openfreemap.org/quick_start/ ; https://openfreemap.org/tos/ |
| **MapLibre GL JS** | Renders the above styles | |

---

## 3. Real-world pitfalls for park-and-ride commuters

Legend: **E** = evidence cited, **R** = reasoning, no direct source (flag in UI as heuristic).

### 3.1 Lot fills early
- **E:** Windsor and Carseldine lots reported full by about 7am by radio callers [S]; Ormeau main lot full early (2018) [S]; minister confirms "demand remains high" (Apr 2026) [V]; government's own modelling flagged parking availability risk at "certain stations" when 50c fares started [S]. Sources in 1.4.
- **E:** Varsity Lakes survey counted 392 then 486 vehicles (2017, 2018) against capacity then in expansion (to 650+), showing annual single-day counts exist but are not public in a feed [V].
- **App:** Let user set "arrive by" for the lot. Show fill risk badge from heuristic ("arrive before about 7:00 on weekdays at busy lots, unverified"). Always offer a **fallback lot** or drive-only alternative.
- **R:** More lots exist than the user knows; sort by "arrival time slack" not just distance.

### 3.2 "Free" street parking near stations vs a 9 hour day
- **E:** Council 2P means **up to 2 hours**; meters have `max_stay_hrs` (sample zone: 3 h, $6.85/h weekday) and no-stopping peaks (6 to 9am, 4 to 7pm on that street) [V]. A 9-hour workday exceeds any 2P/3P limit, so these spots are **not usable for P&R** without risking fines.
- **E:** BCC meter dataset has `max_stay_hrs`, `restrictions`, `operational_time` so the app can reject a street spot whose limit < trip duration [V].
- **E:** Resident permit zones: permit holders exempt, everyone else timed [S]. Dataset `parking-regulated-permit-parking-areas` available [V listed].
- **R:** OSM `maxstay` and `opening_hours` are almost empty for SEQ P&R lots (4 and about 0 tagged), so assume rules unknown and **warn**, not "free all day".
- **App:** Compute `required_stay = outbound + work + return`. Flag spots whose max stay is shorter, and early-bird windows that don't fit (e.g. KGS early bird needs entry 5:30 to 7am **and** exit 1 to 6pm [V]).

### 3.3 The return trip
- **E:** TransLink: park "from first until last service" [V]. So a late return after the **last service** to the lot is a fines/tow risk for the car, and, more practically, the user may have no ride back. Vehicles left unmoved "for an extended period of days" may be considered abandoned [V].
- **E:** Train station car parks are run by Queensland Rail, bus/ferry terminals sometimes by BCC (different contacts) [V]. Closures for upgrades occur (e.g. TransLink notice of Helensvale lift out of service, May 2026) [S].
- **R:** Compute last service from GTFS `stop_times` for the return direction; warn if "last transit to lot" is before the user's planned return time plus margin. Show alternative: drive-only home.
- **R:** Hours for BCC-run garages differ (e.g. KGS 5:30am to midnight) [V].

### 3.4 Multi-stop days (school drop-off, pickup)
- **E:** No SEQ-specific study found. Research on P&R behaviour shows drivers choose to minimise **driving time to nearest station** (50% did; only 15% chose the total-time-minimising route, Twin Cities survey) [S]: https://ssti.us/2020/03/23/commuters-wont-drive-far-to-access-park-and-ride/ . Another source finds commuters who previously went entirely by transit may start driving to the station [S].
- **R:** Trip chaining (school run before station, pickup after) makes P&R infeasible if the car is parked at the lot. Model as "needs car at times X/Y" flag; offer drive-only or drive+park-near-destination variants. Searches for trip-chaining evidence returned nothing specific, so this is reasoning.

### 3.5 Weather
- **E:** Rain slows traffic, scales with intensity. Greater London study: total travel time **+0.1 to 2.1% light, +1.5 to 3.8% moderate, +4.0 to 6.0% heavy** [S, urban, best match]: https://discovery-pp.ucl.ac.uk/1380395/2/1380395.pdf . Literature review: heavy rain **about +4% to +20%** travel time; Washington DC example +14% in adverse weather [S]. Twin Cities freeways: speeds -1 to 2% (trace), -2 to 4% (light), -4 to 7% (heavy) [S]. Shenzhen urban: -1% (light) to -14% (heavy) [S]. FHWA summary: https://ops.fhwa.dot.gov/publications/weatherempirical/sect2.htm . Definitions of light/heavy differ by study; none is Brisbane-specific.
- **R:** Use a small multiplier on drive time (e.g. light x1.02, moderate x1.04, heavy x1.08 to 1.15, tunable) from Open-Meteo precipitation forecast, and add walking time penalty and a "wet walk" warning for long station-to-destination walks. Flag as heuristic, not from SEQ data.
- Note SEQ summer storms and flooding: QLDTraffic events (flood) are the practical signal.

### 3.6 Transfer reliability and frequency
- **E:** Transitous itineraries show alternatives with 1 or 2 transfers within the same minute range (36 to 41 min), so the cost of a missed transfer depends on frequency [V].
- **E:** TransLink publishes GTFS-RT delays, which Transitous consumes [V]. Use them to compute headway and delay-aware buffers.
- **R:** Prefer direct (0 transfer) options when the time difference is under a few minutes. Show "next 3 departures" not just one. Evidence on SEQ-specific transfer unreliability not gathered.

### 3.7 Do P&R trips actually save time/money?
- **E:** Studies (Twin Cities, Pittsburgh capstone) find longer trips favour driving over multimodal; parking subsidies push toward driving [S]. Council CBD parking $26 to $49/day vs $0 P&R + 2 x $0.50 fare [V], so cost saving is large in SEQ but time saving is not guaranteed.
- Sample Transitous result: P&R 36 to 41 min vs a plain-CAR itinerary was not compared here. Direct car time is returned in `direct[]` for comparison (e.g. 17.3 min in one test at 07:30, free-flow, not peak) [V]. **Free-flow routing understates peak driving**, so P&R can look worse than it is in peak unless traffic is applied.

---

## 4. Build recommendations (short)

1. **Data layer:** own P&R table (seed from OSM `park_ride` + TransLink page scrape, record `source`, `confidence`). Capacity and fee defaults to "unknown".
2. **Routing:** Transitous `CAR_PARKING` for fast prototype in SEQ (open-source only, UA set). Otherwise self-host MOTIS/OTP. Always post-filter to known P&R lots.
3. **Proxy** all TransLink GTFS-RT and QLDTraffic calls server-side (no CORS, key hygiene).
4. **Drive time:** free-flow from OSRM/Valhalla/Transitous plus peak multiplier or TomTom for live.
5. **Costs:** fares 0.50 flat (SEQ), parking per lot/CBD rate table, tolls table (dated), fuel via QLD Fuel Price API if a token is obtained.
6. **UX honesty:** label occupancy as "estimated", fullness as heuristic, rain effect as heuristic.
7. **Commercial plans** change the stack: Transitous, OSRM demo, Open-Meteo free, GraphHopper free, main Overpass all need replacing or licensing.

---

## 5. Open questions to resolve next
- What does MOTIS `CAR_PARKING` actually select (P&R-tagged only or all `amenity=parking`)? Re-run Overpass at the car-leg endpoints when the server recovers.
- Does TMR publish the promised P&R open dataset yet? Re-check data.qld.gov.au and the data request.
- Overpass CORS and a re-run of the SEQ count over a wider bbox including Gold Coast and Sunshine Coast.
- QLDTraffic: register a key; check CORS and the actual event volume.
- Wilson, Secure, Care Park current rates and early-bird terms for Brisbane CBD.
- Gold Coast Helensvale and Sunshine Coast lots: any council occupancy sensors?
