// Blackmoor: the asylum map, item legend, notes and scripted beats (DESIGN.md §1).
// One char per cell. Row 0 is north. x grows east, y grows south.
//  walls: # plaster · B brick · W wood · T tile · w window (moonlight) · L locker (hide) · G generator
//         1 2 3 blood-writing walls
//  doors: D door · Y yellow-key ward door · R red-key surgery door · E main gate (opens when the power is on)
//  items: @ start · F flashlight · y yellow key · r red key · u fuse · n note · + battery
//  decor: b bed · c wheelchair · g gurney with a body · i IV stand · p pew · k candles · o operating table
//         x crates · d desk · l ceiling lamp (lit once the power is on) · e red emergency lamp

export const MAP = [
    "BBwBBBBwBBBBwwBBBwBBBBwBBBBwBBBBBBBwBwBwBwBB",
    "B...b#...b#b.dF#...b#...b#+..b#..W...k.k...B",
    "B....#....#.@..#....#....#....#..W....u....B",
    "B....#....#....#.n..#....#....#..W....k....B",
    "B....#....#n...#....#i...#....#l.W.pp...pp.B",
    "B#D#L##D####D####D####D##L#D###..D.........B",
    "B....l.........l..............Y..W.pp...pp.B",
    "Be.......c...............l....1..W.........B",
    "B##D####D####D####DL###D#######..W.pn....p.B",
    "B....#....#....#....#....######n.W.........B",
    "B....#....#....#....#....######.eWWWWWWWWWWB",
    "By...#....#....#....#....######..LBBBBBBBBBB",
    "B...i#+..b#...b#...b#...b#####L..Bd......x.B",
    "B###############WWWWWWLWWWWWWWW.lB.x+......B",
    "B#######L#######W.............W..B.........B",
    "B.......l.......D...d......dr.W..B....l....B",
    "B.........+.....W.............W..D........GB",
    "B..##D###D#L#D##W......l......D..B.........B",
    "B..##..##..##..#W.............W..B.........B",
    "B..##..##..##..#W.n...........W..B..x......B",
    "B..##..##..##..#W.............Wc.BBBBBBBBBBB",
    "B.+##.b##.b##.b#2WWWWWWWWWWWWWW..LTTTTTTTTTB",
    "B..############################l.T.........B",
    "B3DTTTTTTTTTTTT##L############L..T.........B",
    "BT...........eT##.............#..T.......+.B",
    "BT............L##.............#..T..i...i..B",
    "BT...g..g..g..T##..........c..#..T.........B",
    "BT............T##.............#..R....o....B",
    "BT......l.....TTT......l......D..T.........B",
    "BT..............D.............#..T.........B",
    "BT...g..g..g..TTT.............#..T....l....B",
    "BT............T##.............#.lT.........B",
    "BT.u..........T##....+........#..T.......u.B",
    "BT..........n.T##e............#..T........eB",
    "BTTTTTTTTTTTTTT########E#######..TTTTTTTTTTB",
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
];

export const WALLS = "#BWTwLG123";
export const DOORS = "DYRE";
export const SOLID_DECOR = "bcgpoxd";

export const NOTES = [
    { title: "Patient 13 — diary", text: "Day 41. The night nurse came again. She does not walk like the others. She does not breathe like the others.\n\nWhen the lights go out she goes room to room and she counts us. I pretend to sleep. I am very good at pretending to sleep.\n\nIf you are reading this, keep your light low. She likes the light." },
    { title: "Nurse's memo", text: "To all ward staff —\n\nThe Matron has been relieved of duty pending review. Do NOT discuss the incident in Room 9 with patients.\n\nWard keys are to be returned to the nurses' cart at the WEST end of the corridor at the end of every shift. No exceptions.\n\n— Dr. A. Hale" },
    { title: "Maintenance log", text: "Storm took out the mains again. Backup generator in the BOILER ROOM is fine but somebody pulled the fuses — all three. Found one in the CHAPEL, of all places, one in the MORGUE, and Hale locked the last one in SURGERY. Red key's in his office (RECORDS).\n\nGate's electric. No power, no way out.\n\nThere's something walking around down here at night. Not a patient." },
    { title: "Torn hymn sheet", text: "...and she knelt at the altar every night after they took her badge, and she prayed, and something prayed back.\n\nWe stopped coming to chapel after that.\n\nThe candles still light themselves." },
    { title: "Dr. Hale — personal file", text: "Subject M. continues to resist sedation. Dosage tripled. Tremors, loss of pigment, elongation of the fingers — I have no explanation.\n\nShe asked me today why we keep the lights on. She said the dark is where she can finally see.\n\nI am locking the surgery. God help whoever opens it." },
    { title: "Toe tag (scrawled on the back)", text: "SHE CAN'T SEE YOU IN THE LOCKERS\nSHE CAN HEAR YOU RUN\nDON'T LET HER SEE YOU GO IN\n\nturn off your light when she's close\n\nI'm sorry I couldn't get out" },
];

// objective text per phase
export const OBJECTIVES = {
    dark: "Find a light",
    ward: "Get out of the ward — the door is locked",
    key: "Leave the ward",
    power: "Find a way out",
    fuses: (n, have) => `Find the fuses (${n}/3) · bring them to the Boiler Room generator` + (have ? ` · carrying ${have}` : ""),
    gen: "Restore power — the generator is in the Boiler Room",
    escape: "RUN. The main gate in the Lobby is open",
};

// named zones for scripted beats: [x0, y0, x1, y1]
export const ZONES = {
    hub: [31, 1, 32, 34], chapel: [34, 1, 42, 9], morgue: [2, 24, 15, 33], surgery: [34, 22, 42, 33],
    boiler: [34, 12, 42, 19], lobby: [17, 24, 29, 33], records: [17, 14, 29, 20], ward: [1, 1, 29, 12], isolation: [1, 15, 15, 22],
};
export const ZONE_NAMES = { hub: "Main hall", chapel: "Chapel", morgue: "Morgue", surgery: "Operating theatre", boiler: "Boiler room", lobby: "Lobby", records: "Records office", ward: "East ward", isolation: "Isolation" };
