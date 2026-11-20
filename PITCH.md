# ParkHop at the Tanda hackathon

## The one-liner

Tanda knows when thousands of Brisbane shift workers need to be at work. ParkHop gets them there on time, for 50 cents instead of $25 of parking.

## Why it matters to Tanda

- Late and missed shifts cost Tanda's customers money. Hospitality, retail and health rosters start at 6 am and finish after midnight, which is exactly when public transport is thinnest.
- ParkHop reads a Tanda roster through the real Tanda API: `users/me` for the home address, `schedules` for the week, and `departments` and `locations` for where each shift is. It plans every shift's commute and flags the ones that will go wrong, such as no train home after the late close, a lot that is full by the 2 pm start, or "drive this one".
- Built as a feature that fits inside Tanda: an employee sees "Leave 5:10 am, park at Petrie" next to each shift, and a manager sees which shifts are at risk before they publish the roster.

## What makes it more than a maps app

1. **The car is tracked all day.** If you park and ride in the morning, your car is at the lot in the evening. It handles a school drop-off then work (drop and drive straight on) and refuses plans that strand the car.
2. **It plans for reliability, not averages.** It simulates 1,500 days of traffic, missed trains and full lots, then gives a leave-by time that gets you there on time 9 days out of 10.
3. **It is honest.** It always compares against driving and against public transport only, and sometimes the bus wins. It shows what it ruled out and why.
4. **It knows Brisbane.**
   - 137 park 'n' ride lots, plus 158 street and public parking spots near stations, all from OpenStreetMap.
   - 50 cent fares.
   - CBD and precinct parking prices: RBWH $49, PA Hospital $38, the Valley, QUT, UQ.
   - Linkt tolls, using the toll road only when the time saved is worth it.
   - QLD school terms and public holidays in the traffic model.
   - Lots that fill by 7:30 am and empty after 3:45 pm, which hurts afternoon shifts.
5. **Claude runs the app.** Say "Drop the kids at Mango Hill State School by 8:20, then RBWH by 9" and Claude (Opus 5.5, tool use) fills in the stops, runs the planner, picks the option and answers in a couple of sentences. It uses only the planner's numbers, never made-up ones. Voice in, voice out on the phone.

## 3-minute demo script

1. **(0:00) Hook.** "Parking in the CBD is $28 to $49 a day. Trains are 50 cents. So why does everyone drive? Because the free lots are full by 7:30, and nobody knows if the 5:58 will make their 6 am open."
2. **(0:20) Voice.** On the phone, tap the mic: *"Drop the kids at Mango Hill State School by 8:20 then work at the Royal Brisbane Hospital by 9:15, home after 5."* Show the stops filling in, the map drawing, and Claude's answer.
3. **(1:00) Trade-offs.** Point at the cost against time chart:
   - Driving costs far more, because RBWH parking alone is $49 a day.
   - Park and ride after the school run has a full-lot risk.
   - The app shows that risk instead of hiding it.
4. **(1:30) Tanda.** Open My shifts, then Plan my week (demo roster, or a real token):
   - Read out the week tiles: the cost of the plans against driving every shift (about $10 against $300 in testing).
   - Friday's 4 pm start shows that the lot is full until mid-afternoon.
   - The late closes show whether a train still runs home after close.
5. **(2:20) How it's built.**
   - Live TransLink timetables and delays.
   - OpenStreetMap parking, Linkt tolls, QLD calendars.
   - A Monte Carlo reliability model.
   - Claude tool use on the server, with a caching proxy so the demo never waits.
6. **(2:45) Close.** "Inside Tanda, every published roster becomes a commute plan. Fewer late starts for managers, and hundreds of dollars a week back for staff."

## Before presenting (10 minutes)

1. Put `ANTHROPIC_API_KEY=...` in `.env.local`, then run `npm run dev` (or `npm run build && npm run preview`).
2. For the phone, run `tailscale serve --bg --https=8443 http://127.0.0.1:5191`, or plug into the venue wifi.
3. **Warm the cache on the day:** click both example days and Plan my week once. Answers are then served from `.cache/` in under 2 seconds, and still work if the venue wifi drops.
4. Check that the assistant answers one example question.

## Check with the organisers

- Whether code written before the event is allowed. If only work done on the day counts, present this as the idea and prototype, and build the Tanda roster view live on the day.
- The judging criteria. Past Tanda hackathons judged "validated and executed" and "best technical" separately. This pitch covers both.
