#!/usr/bin/env python3
"""Build src/data/seq-lots.json from an Overpass export of SEQ park 'n' ride lots
and the TransLink GTFS stops.txt (for the station each lot serves).

Usage: python3 -I scripts/build-seq-lots.py overpass.json stops.txt > src/data/seq-lots.json

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
    json.dump(out, sys.stdout, indent=1)
    print(f"{len(out)} lots", file=sys.stderr)


if __name__ == '__main__':
    main()
