# On-street parking data near SEQ stations: research

Date checked: 2026-11-21. "Tested" = I ran the request from this machine today. "Unverified" = not confirmed from a primary source.

## 1. Brisbane City Council open data

Portal: https://data.brisbane.qld.gov.au (Opendatasoft, not CKAN; the old `/data/api/3/` CKAN path 404s).
- Catalogue API: `https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets` (tested, JSON)
- Records API: `https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/{id}/records`
- CORS (tested, `curl -I -H "Origin: https://example.com"`): `200`, `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`. Browser-callable directly. Rate-limit headers are exposed (`X-RateLimit-*`); limits not checked.
- Licence on all below: CC BY 4.0 (from the catalogue API `license` field).
- Exports: append `/exports/geojson` or `/exports/csv` to the dataset URL (standard Opendatasoft; not tested here).
- Geo filter works: `where=within_distance(geo_point_2d, geom'POINT(lon lat)', 600m)` (tested).

| Need | Dataset id | Rows | Modified | Current? |
|---|---|---|---|---|
| Meters (rate, max stay, hours) | `brisbane-parking-meters` | 945 | 2026-09-21 | Yes |
| Signs (time limits, days/times) | `parking-sign-locations` | 51,984 | 2026-11-20 | Yes |
| Painted lines (no stopping etc.) | `parking-line-locations` | 53,829 | 2026-11-19 | Yes |
| Resident permit areas | `parking-regulated-permit-parking-areas` | 34 polygons | 2026-11-20 | Yes (some polygons last edited 2018) |
| Clearways | `parking-clearways` | 648 lines | 2026-11-19 | Yes |
| Commercial loading zones | `commercial-vehicle-loading-zones` | not counted | 2026-11-20 | Yes |
| 2-minute passenger loading | `two-minute-passenger-loading-zones` | not counted | 2026-11-20 | Yes |
| Disability parking | `disability-permit-parking-locations` | not counted | 2026-11-20 | Yes |
| Council car parks (CBD) | `brisbane-parking-stations` | 1 row, 2 car parks | 2026-11-20 | Yes, CBD only |
| Occupancy forecasts | `parking-occupancy-forecasting` (+ 2021-22, 2023-24, 2025) | n/a | 2025-12 / 2026-09 | Historical/forecast |
| Rail stations | `railway-station-locations` | 191 | 2026-11-10 | Yes |
| Park and ride | none found | | | Title search for "ride" and "park and ride" returned nothing |

Page URLs: `https://data.brisbane.qld.gov.au/explore/dataset/{id}/`. Also mirrored on data.qld.gov.au and data.gov.au (e.g. https://www.data.qld.gov.au/dataset/brisbane-parking-meters), where a listing showed the licence as "not specified" while the portal says CC BY 4.0. Use the portal value.

### Fields and sample records (fetched today)

Meters (`brisbane-parking-meters`), has max stay, rate, hours, restrictions, point:
```
{"meter_no":"4522","category":"PAY BY MOBILE APP ONLY","street":"EDMONDSTONE RD","suburb":"BOWEN HILLS",
 "max_stay_hrs":"3","restrictions":"NO STOPPING 6AM-9AM,4PM-7PM MON-FRI","operational_day":"MON-FRI",
 "operational_time":"9AM-4PM","tar_zone":"Zone 1, 15 min free","tar_rate_weekday":6.85,"tar_rate_ah_we":null,
 "loc_desc":"Edmondstone St between Folkestone Rd & Abbotsford Rd in Bowen Hills","veh_bays":"3","mc_bays":0,
 "mobile_zone":"4000493","max_cap_chg":null,"geo_point_2d":{"lon":153.039649,"lat":-27.442549}}
```
Signs (`parking-sign-locations`), the dataset that holds time limits. Point per sign, no bay length, no side-of-street geometry beyond `signdirection`:
```
{"assetid":"SN-30-1000-3862673","suburb":"OXLEY","street":"BLUNDER ROAD","parkingrestrictiontype":"No Stopping Any Time",
 "signcategory":"No Stopping","assetlifecycle":"In Service","signowner":"BCC","signdirection":"Left","signtemporary":0,
 "parkingrestrictiondescription":null,"parkingrestrictiondaysandtimes":null,"geo_point_2d":{"lon":152.98025,"lat":-27.56775}}
```
Timed example (St Lucia): `parkingrestrictiontype:"2P Parallel"`, `parkingrestrictiondescription:"RESIDENT PERMITS EXCEPTED"`, `parkingrestrictiondaysandtimes:"MON-FRI:7am-6pm"`. Area signs: `"ST LUCIA TRAFFIC AREA"`, description `"...FEB-NOV,EXCEPT AS SIGNED"`, `MON-FRI:7am-6pm`.
- `parkingrestrictiondaysandtimes` is free text and is filled on only 21,100 of 51,984 signs. `parkingrestrictiondescription` on 13,395. Time-of-day parsing needs care (mixed formats seen: `7am-6pm` and `7:00AM-6:00PM`).
- Top `parkingrestrictiontype` values (tested): No Stopping Any Time 15,538; Bus Zone 6,172; No Stopping Specified Times 4,470; 2P Parallel 4,275; Clearway C repeater (specified times) 1,595; No Parking Any Time 1,553; P (No Limit) 1,501; 2 Min passenger loading 1,464; 12P Meter 1,143; 1/4P 1,000; 1/2P 876; 1P 806; 4P Meter 755; 4P Parallel 634; 3P Parallel 352; plus 3P/2P/1P Meter, Angle variants, Pay By App variants, Traffic Area boundary signs.
- Lines (`parking-line-locations`): `pavementmarkingsubtype` (e.g. "No Stopping Line"), `parkingrestrictiontype`, `markingcolour`, LineString geometry. No time limits.
- Clearways: `category` ("Clearway"), `operational_time` ("AT ALL TIMES"), LineString.
- Permit areas: polygons with `description` (e.g. "AUCHENFLOWER REGULATED PARKING PERMIT AREA"), `category` "Restricted", `installed_date`, `retired_date`, `operational_time` often null.
- Park and ride: Brisbane has no dataset. TransLink lists park 'n' ride only as a web page (https://mobile.translink.com.au/travel-with-us/parking).

### Time limits near stations (tested, 600 m radius of station, sign counts)
- Indooroopilly: 2P 73, 1/4P 16, 4P 16, no stopping 81+33, bus zone 26.
- Wynnum: 2P 74, 1P 34, 1/2P 16, no stopping 81.
- Darra: 3P 13, 1/4P 9, 4P 3.
- Banyo: only 4 "P (No Limit)" and 28 no-stopping signs. No time limits in the data (could mean unsigned streets, or missing data; unverified which).
- So yes, timed limits near stations are queryable in Brisbane, with caveats: signs are points, so you must infer which stretch of kerb each covers; "except as signed" Traffic Area rules (area-wide, e.g. St Lucia) only show as boundary signs, not polygons. Dataset has no "unrestricted" marker: absence of a sign is not proof of anything.
- Brisbane's rule: individual street signs override area-wide conditions; 2P zones carry no limit outside the signed days/times (https://www.brisbane.qld.gov.au/parking-rules/general-parking-rules). Resident permit exemption does not help a non-resident commuter.

## 2. Other councils and the state

| Source | Finding | URL |
|---|---|---|
| Gold Coast | "Public Parking Facilities" has an on-street layer, but features are polygons named "On street parking" with no limits, fees or hours (sample fetched; 2,675 features). CC BY 3.0 AU. WFS/GeoJSON, CORS `*` (tested on GetCapabilities). Not useful for time limits. | https://data.gov.au/data/dataset/8afa38f2-5ace-4fc7-93c2-d3b32a6efba5 ; GeoJSON: https://data.gov.au/geoserver/public-parking-facilities-city-of-gold-coast/wfs?request=GetFeature&typeName=ckan_8afa38f2_5ace_4fc7_93c2_d3b32a6efba5&outputFormat=json |
| Ipswich | "Ipswich City Parking Meters": 110 points, fields `METER_ID`, `METER_REST` (e.g. "9P"), `HOURS_WEEK`, `HOURS_SAT`, `PARKING_BA`, `LOCATION`. CC BY 3.0 AU, WFS/GeoJSON. CBD meters only; no unmetered signs. | https://data.gov.au/data/dataset/ipswich-city-parking-meters ; WFS: https://data.gov.au/geoserver/ipswich-city-parking-meters/wfs?request=GetFeature&typeName=ckan_bc14a5fe_38fc_481e_84b3_186521858511&outputFormat=json |
| Moreton Bay | Data Hub exists on data.gov.au (parks, dog parks etc). No parking dataset found in searches of data.gov.au and data.qld.gov.au. Council parking page links no dataset. | https://www.moretonbay.qld.gov.au/parking |
| Logan, Redland, Sunshine Coast | No parking dataset found on data.gov.au or data.qld.gov.au. Absence from catalogues only; council-own portals not exhaustively searched (unverified). | search of https://data.gov.au/data/api/3/action/package_search |
| data.qld.gov.au (state) | CKAN API works, CORS `*` (tested). No TMR/TransLink park 'n' ride or station car park dataset found (searches "park and ride", "commuter car park"). A user data request asking for park 'n' ride location/capacity exists; outcome unknown. TMR strategy cites 158 facilities and 31,500+ spaces, aggregate only. | https://www.data.qld.gov.au/datarequest/2465016b-78fc-4145-8283-66fd75437142 ; https://www.tmr.qld.gov.au/-/media/aboutus/corpinfo/Publications/Park-n-Ride-Strategy-summary.pdf |

## 3. Commercial and private-space providers

| Provider | Finding | Source |
|---|---|---|
| Parkopedia | Data via REST API or feed (static: location, prices, hours; dynamic: predicted availability). No public pricing, no self-serve or free tier found; sales-led. Acquired by Arrive in 2025 per its About page. Hackathon/developer programme: none found. A catalogue (apis.io) labels pricing "freemium" but that is third-party metadata, unverified. Pages blocked automated fetch (403) so terms were not read. | https://business.parkopedia.com/parking-data ; https://business.parkopedia.com/about |
| SpotHero | Public developer platform but US and Canada only; partner API key required. No Australia evidence. | https://spothero.com/developers |
| Parkhound (Brisbane driveway/space rental) | Listings pages only (e.g. Yeerongpilly Wilkie St, "1 minute walk" to station, $195/month). No API or developer docs found. Scraping is a terms question: unverified. | https://www.parkhound.com.au/parking-yeerongpilly-wilkie-st-qld-18244 |
| Wilson, Secure, CarePark, Parkable, Kerb | No public API or developer programme found in one search. Not individually checked. Treat as none (unverified). | web search 2026-11-21 |
| Brisbane pay-by-app | CellOPark; PayStay added from March 2026 per mayor's release. No public API found. | https://www.adrianschrinner.com.au/media-announcements/parking-shake-up-delivers-faster-and-smarter-options/ |

## 4. OpenStreetMap

Schema (wiki): https://wiki.openstreetmap.org/wiki/Key:parking:lane and https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking (not re-fetched today; the key counts below are from taginfo).
- On the road way: `parking:both|left|right=lane|street_side|on_kerb|half_on_kerb|no|separate|yes`, plus `parking:<side>:orientation=parallel|diagonal|perpendicular`, `parking:<side>:fee=yes|no`, `parking:<side>:maxstay=2 hours`, `parking:<side>:restriction=no_parking|no_stopping|no_standing|...`, and `parking:<side>:restriction:conditional` / `...:fee:conditional` with opening_hours syntax (e.g. `no_parking @ (Mo-Fr 07:00-09:00)`).
- Separate mapped lots: `amenity=parking` + `parking=street_side|lane|surface|...`, with `maxstay`, `fee`, `capacity`, `access`.
- Global taginfo counts (tested 2026-11-21, https://taginfo.openstreetmap.org/api/4/key/overview): `parking:both` 587,913; `parking:left` 219,623; `parking:right` 216,564; `parking:both:restriction` 84,224; `parking:both:fee` 31,027; `parking:both:orientation` 131,910; `parking:both:maxstay` 1,086; `parking:left:maxstay` 1,170; `parking:both:restriction:conditional` 1,977. Max stay is very rare globally.
- `parking=street_side` is used on 1,151,586 objects; `lane` 100,662 (taginfo key `parking`).
- Brisbane coverage (Overpass via https://overpass.private.coffee/api/interpreter, bbox lat -27.62..-27.35, lon 152.90..153.15): 5,123 highway ways carry a `parking:both/left/right` tag. Restriction/maxstay/conditional counts and a denominator of all roads failed (timeouts, 406/empty from other mirrors). Real max-stay coverage in Brisbane is not measured; expect it to be near zero given the global ratio (unverified). Do not rely on OSM for time limits; use it for "is there kerb parking / orientation / no stopping" hints only.
- Note: overpass-api.de refused/timed out for me; Overpass needs a User-Agent.

## 5. Queensland default rules

- Unsigned kerb is not "unrestricted": default road rules still apply everywhere. Parallel to the left kerb; no stopping on a continuous yellow edge line; no parking on footpaths, nature strips or islands in built-up areas unless signed; within 10 m of an intersection without lights (20 m with lights per councils); not across driveways; bus stop zones. Sources: https://www.qld.gov.au/transport/safety/fines/demerit/parking/ , https://www.brisbane.qld.gov.au/parking-rules/general-parking-rules (says "unless otherwise signed"), https://www.moretonbay.qld.gov.au/parking (3 m clear lane, 10 m/20 m intersections; heavy vehicles 4.5 t+ and long vehicles 7.5 m+ max 1 hour in built-up areas).
- Many councils: outside regulated centres, parking is not time-limited if parked lawfully (Townsville states this: https://www.townsville.qld.gov.au/about-townsville/townsville-parking/parking-regulation/parking-rules). I found no equivalent explicit Brisbane or Moreton Bay statement; the Brisbane page does not state a default for unsigned streets. So "no sign = free all day" is the common practice, but I could not cite a primary SEQ council saying it.
- Council limits near stations: Brisbane signs near Indooroopilly, Wynnum and Darra show 1/4P to 4P (data above). Moreton Bay: the 2015 Moreton Bay Rail Link parking plans proposed "Time Limit" and "Time of Day Restriction" signs on residential streets near new stations (Kallangur plan; PDF text could not be read, only metadata, so exact limits unverified): https://www.tmr.qld.gov.au/~/media/Projects/M/Moreton%20Bay%20Rail%20Link/Feedback%20and%20map/KallangurParkingPlanA4PRINT.pdf . Council Kippa-Ring plan (PDF unreadable) was reported to include No Parking 6am-6pm Mon-Fri, permits excepted (unverified, from search summary): https://www.moretonbay.qld.gov.au/files/assets/public/services/licence-regulations/mbrl-parking/kippa-ring.pdf . I found no confirmed 2-hour limits at Petrie or Kallangur.
- Moreton Bay regulation basis: Parking Local Law 2023, https://www.moretonbay.qld.gov.au/files/assets/public/v/1/services/local-laws/parking-local-law-2023.pdf .
- Demand evidence: Strathpine station commuters unable to find parking, https://www.parliament.qld.gov.au/work-of-assembly/petitions/petition-details?id=1610 .

## Implications for the planner
- Usable now from a browser (CORS `*`, JSON): Brisbane Opendatasoft API (meters, signs, lines, permit areas, clearways, stations), data.qld.gov.au CKAN, data.gov.au GeoServer WFS (Gold Coast, Ipswich).
- Only Brisbane gives time limits near stations (signs + meters). Outside Brisbane, nothing usable for on-street limits.
- Must handle: sign points not kerb segments, free-text times, area-wide Traffic Areas, permit-excepted signs, "no sign" ambiguity. Show "check the signs" caveat.
