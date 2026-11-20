#!/usr/bin/env python3
"""Build src/data/seq-lots.json from an Overpass export of SEQ park 'n' ride lots
and the TransLink GTFS stops.txt (for the station each lot serves).

Usage: python3 -I scripts/build-seq-lots.py pnr.json stops.txt [other-parking.json] > src/data/seq-lots.json

other-parking.json (optional) is an Overpass export of amenity=parking without
park_ride. From it we keep public car parks and kerbside parking within a short
walk of a station, as extra candidates. Their time limits are usually not
mapped, so the app tells people to check the signs.

Fill times: no public per-lot data exists for SEQ (see docs/research.md), so we
estimate from capacity and distance to the CBD and mark them "estimated".
"""
import csv
import json
import math
import sys

CBD = (-27.4698, 153.0251)


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def station_modes(name):
    n = name.lower()
    if 'ferry' in n:
        return ['ferry']
    if any(k in n for k in ('busway', 'bus station', 'interchange', 'shopping centre', 'loganholme', 'marina')):
        return ['bus']
    if 'light rail' in n:
        return ['tram']
    return ['rail']


def estimate_fill(cap, dist):
    """Rough weekday 'full by' time (HH:MM): small and inner lots fill earliest."""
    if cap is None:
        base = 7 * 60 + 45
    elif cap < 120:
        base = 7 * 60 + 10
    elif cap < 300:
        base = 7 * 60 + 35
    elif cap < 600:
        base = 7 * 60 + 55
    else:
        base = 8 * 60 + 20
    if dist < 12:
        base -= 20
    elif dist > 40:
        base += 25
    return f"{base // 60:02d}:{base % 60:02d}"


import re


def parse_maxstay_hours(v):
    """'2 hours', '120 minutes', '2h', 'P2' -> hours, or None if unknown."""
    if not v:
        return None
    v = v.strip().lower()
    m = re.match(r'^p?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)?$', v)
    if m:
        return float(m.group(1))
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes)$', v)
    if m:
        return float(m.group(1)) / 60
    return None


STREET = ('street_side', 'lane', 'on_kerb', 'half_on_kerb')
CARPARK = ('surface', 'multi-storey', 'underground', 'rooftop')
SKIP_ACCESS = ('private', 'no', 'permit', 'customers', 'destination', 'staff', 'students', 'disabled', 'restricted', 'unknown', 'delivery')


def nearest(stations, lat, lon):
    best, best_km = None, 99
    for s in stations:
        d = km((lat, lon), (s['lat'], s['lon']))
        if d < best_km:
            best, best_km = s, d
    return best, best_km


def other_parking(path, stations, pnr_fill):
    """Kerbside parking and public car parks within ~500 m of a station."""
    out = []
    for e in json.load(open(path))['elements']:
        t = e.get('tags', {})
        if t.get('park_ride') not in (None, 'no'):
            continue
        lat = e.get('lat') or e.get('center', {}).get('lat')
        lon = e.get('lon') or e.get('center', {}).get('lon')
        if lat is None or t.get('access') in SKIP_ACCESS:
            continue
        kind_tag = t.get('parking')
        if kind_tag in STREET:
            kind = 'street'
        elif kind_tag in CARPARK and t.get('access') in ('yes', 'public', 'permissive'):
            kind = 'carpark'
        else:
            continue
        st, d = nearest(stations, lat, lon)
        if not st or d > 0.5 or km((lat, lon), CBD) < 4:
            continue
        hours = parse_maxstay_hours(t.get('maxstay'))
        if hours is not None and hours < 9:
            continue  # cannot cover a working day
        fee = t.get('fee')
        cap = None
        try:
            cap = int(t['capacity']) if 'capacity' in t else None
        except ValueError:
            pass
        short = st['name'].replace(' station', '').replace(' interchange', '')
        name = t.get('name') if kind == 'carpark' and t.get('name') else (f'{short} street parking' if kind == 'street' else f'{short} public car park')
        # Kerbside spots near a station fill with overflow soon after the station lot.
        base = pnr_fill.get(st['name'])
        if base:
            hh, mm = map(int, base.split(':'))
            fill = hh * 60 + mm + (10 if kind == 'street' else 0)
            fills = f'{fill // 60:02d}:{fill % 60:02d}'
        else:
            fills = '07:50'
        lot = {
            'id': f"osm-{e['type'][0]}{e['id']}",
            'name': name,
            'kind': kind,
            'lat': round(lat, 6),
            'lon': round(lon, 6),
            'perDay': 0 if fee in (None, 'no') else 8,
            'stayKnown': hours is not None,
            'feeKnown': fee is not None,
            'extraParkMin': 3 if kind == 'street' else 1,
            'fillsByHhmm': fills,
            'fillSource': 'estimated',
            'station': {'name': st['name'], 'lat': round(st['lat'], 6), 'lon': round(st['lon'], 6), 'modes': station_modes(st['name'])},
            'source': 'OpenStreetMap contributors (ODbL)',
        }
        if hours is not None:
            lot['maxStayHours'] = hours
        if cap is not None:
            lot['capacity'] = cap
        lot['_d'] = d
        out.append(lot)
    # Keep the two closest kerbside areas and the closest car park per station.
    keep = []
    for kind, n in (('street', 2), ('carpark', 1)):
        by_station = {}
        for l in sorted((l for l in out if l['kind'] == kind), key=lambda l: l['_d']):
            by_station.setdefault(l['station']['name'], []).append(l)
        for ls in by_station.values():
            keep.extend(ls[:n])
    for l in keep:
        del l['_d']
    return keep


def main():
    osm = json.load(open(sys.argv[1]))
    stations = []
    with open(sys.argv[2], newline='') as f:
        for r in csv.DictReader(f):
            if r['location_type'] == '1':
                stations.append({'name': r['stop_name'], 'lat': float(r['stop_lat']), 'lon': float(r['stop_lon'])})
    lots = []
    for e in osm['elements']:
        t = e.get('tags', {})
        lat = e.get('lat') or e.get('center', {}).get('lat')
        lon = e.get('lon') or e.get('center', {}).get('lon')
        if lat is None:
            continue
        if t.get('access') in ('private', 'no'):
            continue
        if t.get('maxstay', '').endswith('minutes'):
            continue  # kiss-and-ride bays
        best, best_km = None, 9
        for s in stations:
            d = km((lat, lon), (s['lat'], s['lon']))
            if d < best_km:
                best, best_km = s, d
        if not best or best_km > 1.2:
            continue
        cap = None
        try:
            cap = int(t['capacity']) if 'capacity' in t else None
        except ValueError:
            pass
        dist = km((lat, lon), CBD)
        if dist < 4:
            continue  # inner-city parking is not park-and-ride
        fee = t.get('fee', 'no')
        name = t.get('name') or ''
        if not name or name.lower().startswith(('queensland rail', 'translink', 'park')):
            name = f"{best['name'].replace(' station', '').replace(' interchange', '')} park 'n' ride"
        lot = {
            'id': f"osm-{e['type'][0]}{e['id']}",
            'name': name,
            'kind': 'pnr',
            'stayKnown': True,
            'feeKnown': 'fee' in t,
            'lat': round(lat, 6),
            'lon': round(lon, 6),
            'perDay': 0 if fee == 'no' else 5,
            'fillsByHhmm': estimate_fill(cap, dist),
            'fillSource': 'estimated',
            'station': {
                'name': best['name'],
                'lat': round(best['lat'], 6),
                'lon': round(best['lon'], 6),
                'modes': station_modes(best['name']),
            },
            'source': 'OpenStreetMap contributors (ODbL)',
        }
        if cap is not None:
            lot['capacity'] = cap
        lots.append(lot)
    # Several OSM areas can describe one site: keep the largest per station + name.
    merged = {}
    for l in lots:
        k = (l['station']['name'], l['name'])
        if k not in merged or (l.get('capacity') or 0) > (merged[k].get('capacity') or 0):
            merged[k] = l
    out = sorted(merged.values(), key=lambda l: l['name'])
    if len(sys.argv) > 3:
        pnr_fill = {}
        for l in out:
            pnr_fill.setdefault(l['station']['name'], l['fillsByHhmm'])
        extra = other_parking(sys.argv[3], stations, pnr_fill)
        print(f"{len(extra)} street and car park spots", file=sys.stderr)
        out += sorted(extra, key=lambda l: l['name'])
    json.dump(out, sys.stdout, indent=1)
    print(f"{len(out)} spots", file=sys.stderr)


if __name__ == '__main__':
    main()
