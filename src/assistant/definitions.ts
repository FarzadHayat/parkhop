// The assistant's system prompt and tool definitions. Shared by the server
// (which sends them to Claude) and the browser (which runs the tools).
// Keep this file free of browser and Node imports, and keep it byte-stable:
// it is the cached prefix of every assistant request.

export const ASSISTANT_MODEL = 'claude-opus-5-5'

export const SYSTEM_PROMPT = `You are ParkHop's commute assistant for Brisbane and South East Queensland. ParkHop finds the best mix of driving to a free park 'n' ride and taking TransLink trains, buses, ferries or the Brisbane Metro, and compares it with driving all the way and with public transport only.

Your tools change the app the person is looking at, so use them rather than describing what they could do.

How to work:
- When the person describes a day or a trip, call set_day with every stop in order, then call plan_options, then answer.
- The first and last stop are home unless they say otherwise. If a stop is already set in <app_state> and they did not change it, pass "keep" as its place.
- A school drop-off is a short stop: stay 5 minutes, no parking. Work stops usually have an arrive-by time and a leave-after time.
- If they have a parking permit, a staff car park or free parking at a place, set that stop's parking to "permit" (ParkHop remembers it). "default" already uses a saved permit.
- For "I need the car for pickup" or similar, set that leg's rule to "car". For "no driving" use "transit".
- If they ask about their Tanda shifts, roster or week, call plan_shifts.
- If something is ambiguous, make a sensible Brisbane assumption, act, and say what you assumed in a few words.

How to answer:
- At most three short sentences, written to be read aloud: the recommendation, when to leave, the cost per day compared with driving, and the one risk that matters most.
- Use only numbers that tools returned. Never invent times, prices or service names.
- Say times like "7:20 am". Use Australian English.

Brisbane facts you can rely on: TransLink fares are a flat 50 cents per trip. All-day parking in the CBD costs about $28 early bird and up to $49. Free park 'n' ride lots near the city often fill before 7:30 am. Queensland does not use daylight saving.`

type JsonSchema = Record<string, unknown>

export interface ToolDef {
  name: string
  description: string
  input_schema: JsonSchema
}

const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] })

export const TOOLS: ToolDef[] = [
  {
    name: 'set_day',
    description:
      'Replace the day being planned with these stops, in order. Places are free text that will be searched near Brisbane (an address, suburb, school, hospital, station or business), or "keep" to keep the place already set for a stop with the same label. Returns the places found, so you can check them.',
    input_schema: {
      type: 'object',
      properties: {
        date: { ...nullable({ type: 'string' }), description: 'Travel date as YYYY-MM-DD, or null to keep the current date.' },
        stops: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short name shown in the app, e.g. Home, School, Work, Gym.' },
              place: { type: 'string', description: 'Search text for the place, or "keep".' },
              arrive_by: { ...nullable({ type: 'string' }), description: 'Latest arrival, 24 hour HH:MM.' },
              leave_after: { ...nullable({ type: 'string' }), description: 'Earliest departure from this stop, 24 hour HH:MM.' },
              stay_min: { ...nullable({ type: 'integer' }), description: 'Minimum minutes spent at the stop.' },
              parking: {
                enum: ['default', 'none', 'free', 'paid', 'permit'],
                description: 'Parking at this stop. "default" uses a saved permit or the usual price for the area. "permit" means they have their own parking there.',
              },
              parking_per_day: { ...nullable({ type: 'number' }), description: 'Daily price when parking is "paid", or what a permit costs per day (null = free).' },
            },
            required: ['label', 'place', 'arrive_by', 'leave_after', 'stay_min', 'parking', 'parking_per_day'],
            additionalProperties: false,
          },
        },
        leg_rules: {
          type: 'array',
          description: 'One per leg between stops (stops minus one). any = let ParkHop choose, car = arrive with your own car, transit = no car.',
          items: { enum: ['any', 'car', 'transit'] },
        },
      },
      required: ['date', 'stops', 'leg_rules'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan_options',
    description:
      'Plan the current day with live timetables, traffic estimates, park n ride lots and weather, and rank the options. Returns each option with leave-by time, cost per day, travel minutes, chance of being on time, warnings, and the plans that were ruled out. Takes 5 to 40 seconds.',
    input_schema: {
      type: 'object',
      properties: {
        priority: { enum: ['balanced', 'cheapest', 'fastest', 'reliable'], description: 'How to rank options.' },
      },
      required: ['priority'],
      additionalProperties: false,
    },
  },
  {
    name: 'select_option',
    description: 'Show one planned option on the map and in the detail view.',
    input_schema: {
      type: 'object',
      properties: { option_id: { type: 'string' } },
      required: ['option_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan_shifts',
    description:
      "Load the person's upcoming shifts from Tanda (or the demo roster) and plan the commute for each one. Returns each shift with the best way to get there and back, the cost, and shifts where public transport does not run or the lot will be full.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
]
