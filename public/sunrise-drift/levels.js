// Sunrise Drift flights (DESIGN.md §2). Wind layers: {top (m, absolute altitude), dir (deg the wind blows TOWARD,
// 0 = north/+y, 90 = east/+x), spd (m/s)}. Targets / landing are world x, y. tod = palette key below.

export const FLIGHTS = [
  { name: "First Light", tod: "blue", mist: 1.0, fuel: 100, pattern: 0, start: [-200, -700],
    layers: [{ top: 160, dir: 25, spd: 3 }, { top: 350, dir: 80, spd: 4.5 }, { top: 1e9, dir: 340, spd: 5 }],
    targets: [[-57, -404]], land: [31, -148, 75], stars: [120, 190, 250],
    tip: "Hold BURN to heat the envelope — the balloon answers slowly. Different heights blow different ways." },
  { name: "Golden Valley", tod: "sunrise", mist: 0.8, fuel: 100, pattern: 1, start: [-130, -300],
    layers: [{ top: 130, dir: 350, spd: 2.5 }, { top: 250, dir: 10, spd: 0.8 }, { top: 440, dir: 65, spd: 5 }, { top: 1e9, dir: 300, spd: 4 }],
    targets: [[-180, -55], [-177, 73]], land: [-177, 222, 80], stars: [200, 300, 380],
    tip: "There is a calm layer in the middle — park there while you line up." },
  { name: "Chimney Run", tod: "sunrise", mist: 0.5, fuel: 95, pattern: 2, start: [120, -520],
    layers: [{ top: 120, dir: 45, spd: 3 }, { top: 290, dir: 345, spd: 4 }, { top: 1e9, dir: 100, spd: 6 }],
    targets: [[316, -382], [242, -67]], land: [234, 156, 80], stars: [190, 290, 370],
    tip: "Keep clear of the rock towers — a bump costs points." },
  { name: "The Box", tod: "morning", mist: 0.3, fuel: 100, pattern: 3, start: [-100, -40],
    layers: [{ top: 140, dir: 8, spd: 3.5 }, { top: 290, dir: 90, spd: 2 }, { top: 1e9, dir: 190, spd: 4 }],
    targets: [[-58, 272], [128, 349], [283, 308]], land: [316, 441, 80], stars: [280, 400, 500],
    tip: "A box wind: low goes north, high comes back south. Ride the loop." },
  { name: "High Morning", tod: "morning", mist: 0.15, fuel: 85, pattern: 4, start: [-420, -900],
    layers: [{ top: 170, dir: 30, spd: 3 }, { top: 410, dir: 70, spd: 7 }, { top: 1e9, dir: 18, spd: 9 }],
    targets: [[-333, -742], [114, -424], [494, -234]], land: [567, -140, 90], stars: [260, 380, 470],
    tip: "Fast winds up high and limited fuel — climb once, then glide." },
  { name: "Lantern Dusk", tod: "dusk", mist: 0.35, fuel: 100, pattern: 5, start: [-560, 60],
    layers: [{ top: 140, dir: 75, spd: 2.5 }, { top: 320, dir: 15, spd: 3.5 }, { top: 1e9, dir: 125, spd: 4 }],
    targets: [[-336, 85], [-246, 287], [-134, 462]], land: [-37, 485, 80], stars: [270, 390, 490],
    tip: "Lanterns rise from the village. Finish by the river before dark." },
];

export const TOD = {
  blue: { sun: [0.92, -0.2, 0.03], sc: [0.75, 0.45, 0.4], top: [0.07, 0.1, 0.24], hor: [0.62, 0.48, 0.6], glow: [0.9, 0.45, 0.35], at: [0.24, 0.26, 0.4], ab: [0.16, 0.13, 0.16], night: 0.35 },
  sunrise: { sun: [0.95, 0.12, 0.08], sc: [1.85, 1.05, 0.6], top: [0.22, 0.36, 0.66], hor: [1.0, 0.72, 0.55], glow: [1.4, 0.72, 0.38], at: [0.38, 0.4, 0.55], ab: [0.3, 0.22, 0.17], night: 0 },
  morning: { sun: [0.75, 0.3, 0.42], sc: [1.75, 1.45, 1.1], top: [0.24, 0.45, 0.82], hor: [0.78, 0.82, 0.9], glow: [0.8, 0.6, 0.4], at: [0.42, 0.48, 0.62], ab: [0.3, 0.27, 0.22], night: 0 },
  dusk: { sun: [-0.92, 0.3, 0.05], sc: [1.6, 0.6, 0.35], top: [0.14, 0.14, 0.36], hor: [1.0, 0.5, 0.42], glow: [1.3, 0.45, 0.32], at: [0.3, 0.26, 0.4], ab: [0.18, 0.12, 0.12], night: 0.5 },
};
