// Storm Beacon nights (DESIGN.md §2). Reefs are [x, y, radius]; the safe channel is ROUTE (ships aim for these
// waypoints in order once the light gives them their bearings). storm scales the waves, rain and the blind drift.

export const ROUTE = [[-40, 600], [-110, 420], [-170, 270], [-212, 160], [-215, 82]];
const BASE_REEFS = [[60, 470, 28], [-170, 520, 30], [-20, 320, 26], [-250, 330, 30], [-90, 200, 22], [-300, 180, 26], [70, 230, 30], [140, 400, 24]];

export const NIGHTS = [
  { name: "Squall", ships: 5, every: [26, 32], storm: 0.55, current: [0.25, 0], rain: 0.45, bolt: [14, 26], types: { fishing: 2, coaster: 3 }, reefs: BASE_REEFS.slice(0, 6),
    tip: "Point at the sea to swing the beam. A ship in the light finds the channel — in the dark it drifts onto the rocks." },
  { name: "Gale Warning", ships: 8, every: [17, 24], storm: 0.75, current: [0.55, 0], rain: 0.6, bolt: [10, 20], types: { fishing: 3, coaster: 3, schooner: 2 }, reefs: BASE_REEFS,
    tip: "Ships overlap now. Give each a good dose of light, then move on — they remember it for a few seconds." },
  { name: "The Narrows", ships: 10, every: [15, 21], storm: 0.8, current: [-0.6, 0], rain: 0.65, bolt: [9, 18], types: { coaster: 4, schooner: 3, steamer: 3 }, reefs: BASE_REEFS.concat([[-60, 410, 18], [-195, 395, 20],]),
    tip: "A reef field splits the approach. Hold the button to focus the beam into a long, narrow spear." },
  { name: "Fishing Fleet", ships: 14, every: [8, 14], storm: 0.9, current: [0.75, -0.1], rain: 0.75, bolt: [8, 16], types: { fishing: 9, coaster: 3, steamer: 2 }, reefs: BASE_REEFS.concat([[-60, 410, 18], [10, 560, 22]]),
    tip: "The fleet runs home in packs. Sound the horn (Space) to hold everyone back while you sort them out." },
  { name: "Black Squall", ships: 16, every: [9, 15], storm: 1.0, current: [0.6, 0], gust: true, rain: 1.0, bolt: [5, 11], types: { fishing: 5, coaster: 4, schooner: 3, steamer: 4 }, reefs: BASE_REEFS.concat([[-60, 410, 18], [-195, 395, 20], [10, 560, 22], [-60, 300, 10]]),
    tip: "The worst night of the year. Rain shortens the beam and the current gusts both ways. Bring them home." },
];
