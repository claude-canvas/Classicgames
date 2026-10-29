// Lanternfall story (DESIGN.md §1, §3): one async script per chapter, written against the game API `G` (main.js).
// Checkpoints: `if (G.from <= n)` blocks are skipped when a saved game resumes at a later checkpoint.
// Dialogue lines: { w: speaker id, t: text, m: mood ("happy" | "sad" | "angry" | "shock") }, or { choice: [[label, id]] }.

export const CHAPTERS = [
  { n: "I", title: "The Last Lantern", sub: "Willowmere · sunset", run: chapter1 },
  { n: "II", title: "The Whispering Woods", sub: "The old forest · dusk", run: chapter2 },
  { n: "III", title: "The Drowned Mill", sub: "Black River · midnight", run: chapter3 },
  { n: "IV", title: "The Hollow Spire", sub: "The King's tower · eclipse", run: chapter4 },
];

// ------------------------------------------------------------------ Chapter I
async function chapter1(G) {
  const S = G.map.spots;
  G.npc("bram", "bram", S.bram, Math.PI * 1.5);
  G.npc("sela", "sela", S.sela, -0.4);
  G.npc("hob", "hob", S.hob, Math.PI);
  G.npc("lila", "lila", S.lila, -Math.PI / 2);
  G.npc("rook", "rook", S.rook, -Math.PI / 2);
  G.chatter("hob", [[{ w: "hob", t: "Mira! Honey-cakes shaped like little lanterns. One for you, one for Bram — don't eat his on the way.", m: "happy" }, { w: "mira", t: "I would never." }, { w: "hob", t: "You ate his last year." }, { w: "mira", t: "...Allegedly." }],
    [{ w: "hob", t: "Forty years I've baked for this festival. Never once have the lanterns gone out. Not once." }]]);
  G.chatter("lila", [[{ w: "lila", t: "Mira, Mira! Is it true the Hollow eats colours? Mum says if I stay out past dark it'll eat my ribbons.", m: "shock" }, { w: "mira", t: "Your ribbons are safe. That's what lantern keepers are for." }, { w: "lila", t: "Then light them extra bright, okay? Extra extra.", m: "happy" }],
    [{ w: "lila", t: "When I grow up I'm going to be a lantern keeper too. Or a dragon. Probably a lantern keeper." }]]);
  G.chatter("sela", [[{ w: "sela", t: "Off to light the lamps? Take some feverfew for Bram — his knees creak louder than his stairs." }, { w: "mira", t: "He says the creaking is 'wisdom settling'." }, { w: "sela", t: "Then he is the wisest man in the valley.", m: "happy" }],
    [{ w: "sela", t: "Strange… my herbs have all turned toward the north today. Like they're hiding from something." }]]);
  G.chatter("rook", [[{ w: "rook", t: "Quiet watch tonight, apprentice. Just the way I like it." }, { w: "mira", t: "You say that every year." }, { w: "rook", t: "And every year it's true. Go on — the lamps won't light themselves." }],
    [{ w: "rook", t: "My brother used to stand this post with me. Before the Hollow took him on the north road. ...Off you go, now.", m: "sad" }]]);

  if (G.from <= 0) {
    await G.chapterCard(0);
    await G.say([
      { w: "mira", t: "The Festival of Lights… and I overslept. Bram is going to give me The Look." },
      { w: "mira", t: "The one where his eyebrows do all the talking." },
    ]);
    G.hint("Move with WASD · drag the mouse (or Q / E) to turn the camera");
    G.checkpoint(1);
  }
  if (G.from <= 1) {
    G.objective("Meet Bram at Lantern Hill", "bram");
    await G.talkTo("bram");
    await G.say([
      { w: "bram", t: "There she is. The sun's nearly down and my apprentice is still yawning.", m: "happy" },
      { w: "mira", t: "I wasn't yawning. I was… breathing heroically." },
      { w: "bram", t: "Hm. Listen, Mira. Tonight matters more than you know. The Hollow has been pressing at the valley's edge all autumn." },
      { w: "bram", t: "Every lamp we light is a promise: the dark may come, but it does not stay." },
      { w: "bram", t: "Light the three lamps around the square. I'll ready the Last Lantern. When all four burn together, the valley is safe for another year." },
      { choice: [["I won't let you down.", "brave"], ["Can I have a honey-cake first?", "cake"]] },
    ]).then((c) => c === "cake" && G.say([{ w: "bram", t: "Lamps first. Cakes are a reward, not a strategy.", m: "happy" }]));
    G.hint("Press F to talk and interact");
    G.checkpoint(2);
  }
  if (G.from <= 2) {
    const lamps = ["lamp1", "lamp2", "lamp3"];
    let n = 0;
    G.objective(`Light the village lamps (0/3)`, lamps);
    while (n < 3) {
      const id = await G.interactAny(lamps.filter((l) => !G.isLit(l)), "Light the lamp");
      G.lit(id, true); n++; G.sfx("light");
      G.objective(`Light the village lamps (${n}/3)`, lamps.filter((l) => !G.isLit(l)));
      if (n === 1) G.bark("mira", "One down!");
      if (n === 2) G.bark("lila", "Extra extra bright!");
    }
    G.checkpoint(3);
  }
  if (G.from <= 3) {
    for (const l of ["lamp1", "lamp2", "lamp3"]) G.lit(l, true);
    G.objective("Return to Bram at Lantern Hill", "bram");
    await G.reach(G.map.spots.hill, 8);
    G.lit("last", true);
    await G.say([
      { w: "bram", t: "Well done. Now — together. The Last Lantern…", m: "happy" },
      { w: "bram", t: "...Wait. Do you feel that? The wind's gone cold." },
    ]);
    G.setEnv("dusk", 5);
    G.sfx("omen");
    await G.wait(1.2);
    await G.say([
      { w: "lila", t: "MIRA! The sky — it's going purple!", m: "shock" },
      { w: "bram", t: "Shadow wisps. Dozens of them. Mira, your staff — strike them back into the dark!", m: "angry" },
    ]);
    G.hint("J / left click to strike · Space to dodge roll · H to drink a potion");
    await G.fight([["wisp", -4, 30], ["wisp", 5, 31], ["wisp", 7, 40], ["wisp", -7, 40]]);
    G.bark("bram", "More coming! Keep moving!");
    await G.fight([["wisp", -8, 33], ["wisp", 8, 33], ["shade", 0, 26], ["wisp", 0, 48]]);
    G.checkpoint(4);
  }
  if (G.from <= 4) {
    G.objective("", null);
    G.lit("last", true);
    G.setEnv("dusk", 0.01);
    G.npcAt("bram", G.map.spots.bram, Math.PI * 1.5);
    G.placePlayer([0, 33], Math.PI / 2);
    await G.wait(0.6);
    G.npc("vesper", "vesper", G.map.spots.vesper, -Math.PI / 2);
    G.fx("smoke", [...G.map.spots.vesper, 0]);
    G.sfx("vesper");
    G.focus("vesper");
    await G.say([
      { w: "vesper", t: "How touching. The old keeper and his little spark, guarding a candle against the night." },
      { w: "bram", t: "...Vesper. I hoped I'd never see you again.", m: "shock" },
      { w: "vesper", t: "You taught me to fear the dark, old man. You never taught me to win against it." },
      { w: "vesper", t: "So I learned on my own. Every light in this valley will burn in my Spire — in my lantern — where no shadow can ever take it." },
      { w: "mira", t: "Those lights aren't yours! People need them!", m: "angry" },
      { w: "vesper", t: "People need to be safe. I will be their only light. Is that not kinder?" },
      { w: "bram", t: "Mira — stay back. This is between me and my first apprentice." },
      { w: "vesper", t: "Your first failure, you mean." },
    ]);
    G.act("vesper", "cast", 1.6);
    G.sfx("snuff");
    G.lit("last", false);
    G.flash(0.6);
    G.setEnv("dusk", 0.01, { dim: 1 });
    await G.wait(0.9);
    await G.say([{ w: "vesper", t: "Come, old teacher. You'll want a front-row seat when the sun goes into the jar." }, { w: "bram", t: "Mira! The staff — find Sela, she knows wh—", m: "shock" }]);
    G.act("bram", "lift", 2.2); G.act("vesper", "lift", 2.2);
    G.fx("smoke", [...G.map.spots.bram, 0]); G.fx("smoke", [...G.map.spots.vesper, 0]);
    await G.wait(2.2);
    G.remove("bram"); G.remove("vesper");
    G.focus(null);
    await G.say([{ w: "mira", t: "BRAM!", m: "shock" }, { w: "mira", t: "...He's gone. They're both gone.", m: "sad" }]);
    G.checkpoint(5);
  }
  if (G.from <= 5) {
    G.setEnv("dusk", 0.01, { dim: 1 }); G.lit("last", false);
    G.npcAt("sela", [-3, 30], Math.PI / 2);
    G.objective("Talk to Sela", "sela");
    await G.talkTo("sela");
    await G.say([
      { w: "sela", t: "Mira! I saw the Lantern go dark from my garden. Are you hurt?", m: "shock" },
      { w: "mira", t: "Vesper took him. He called Bram his teacher. Sela — who IS he?", m: "sad" },
      { w: "sela", t: "A story Bram never liked to tell. Here — he left this in my keeping years ago, 'for the day the dark answers back'." },
      { w: "sela", t: "His Sunstaff. It remembers every lamp he ever lit. Grip it, and let it remember for you." },
    ]);
    G.give("sunstaff"); G.give("potion", 3);
    G.sfx("item");
    G.hint("Sunstaff! K / right click — LIGHT BURST: blasts nearby shadows and burns away shadow thorns (costs light)");
    await G.say([
      { w: "sela", t: "And these — three of my best tonics. Drink when it hurts. Not after.", m: "happy" },
      { w: "sela", t: "Vesper's Spire lies past the Whispering Woods and the Black River. Captain Rook holds the north gate." },
      { w: "mira", t: "Then I'm going through it." },
    ]);
    G.objective("Go to the north gate", G.map.spots.gate);
    await G.talkTo("rook");
    await G.say([
      { w: "rook", t: "I heard. I'm sorry, Mira. I'd come with you, but if the Hollow returns, Willowmere needs every blade it has." },
      { w: "rook", t: "The woods past this gate whisper. Don't answer them. And if you meet a knight in black armour…" },
      { w: "rook", t: "...Just run.", m: "sad" },
      { choice: [["I'll bring Bram home.", "a"], ["I'm done running.", "b"]] },
    ]);
    await G.say([{ w: "rook", t: "Light keep you, apprentice." }]);
    G.objective("Leave Willowmere", [0, 92]);
    await G.reach([0, 90], 6);
    await G.endChapter();
  }
}

// ------------------------------------------------------------------ Chapter II
async function chapter2(G) {
  const S = G.map.spots;
  G.lit("camp", true);
  if (G.from <= 0) {
    await G.chapterCard(1);
    await G.say([{ w: "mira", t: "The Whispering Woods. Rook said not to answer the whispers." }, { w: "mira", t: "...Nobody's whispering. Good. Great. Love that for me." }]);
    G.checkpoint(1);
  }
  if (G.from <= 1) {
    G.objective("Follow the forest road", S.tobi);
    await G.reach(S.tobi, 13);
    G.npc("tobi", "tobi", S.tobi, 0);
    G.lit("tobiThorns", true);
    await G.say([
      { w: "tobi", t: "Help! Anyone! Preferably someone NOT made of shadow and teeth!", m: "shock" },
      { w: "mira", t: "A… talking fox?", m: "shock" },
      { w: "tobi", t: "A talking fox stuck in evil thorns, yes, well spotted. Could you maybe do the shiny thing with your stick?" },
    ]);
    G.objective("Free the fox — burn the thorns with a Light Burst (K)", S.tobi);
    await G.burned("tobiThorns");
    await G.say([
      { w: "tobi", t: "FREE! Oh, glorious tail, you're intact!", m: "happy" },
      { w: "tobi", t: "Tobi. Professional forager, amateur coward. Those shades grabbed every lamp-bug in the woods and left me as dessert." },
      { w: "mira", t: "Mira. I'm going to the Hollow Spire to get my teacher back." },
      { w: "tobi", t: "The Spire. On purpose. With your legs.", m: "shock" },
      { w: "tobi", t: "...You know what, you saved my life. The road's sealed by the old shrine — it needs three Sun Shards. I know where they're hidden. I'm coming." },
      { choice: [["Welcome aboard, Tobi.", "a"], ["Are you sure? It's dangerous.", "b"]] },
    ]);
    G.follow("tobi");
    G.checkpoint(2);
  }
  if (G.from <= 2) {
    G.npcIf("tobi", S.tobi); G.follow("tobi"); G.lit("tobiThorns", false);
    G.lit("roadThorns", true);
    G.objective("Burn the thorns blocking the road", [0, -14]);
    await G.burned("roadThorns");
    G.bark("tobi", "Ha! Take that, evil hedge!");
    G.checkpoint(3);
  }
  if (G.from <= 3) {
    G.lit("roadThorns", false);
    const shards = ["shardA", "shardB", "shardC"];
    const got = () => shards.filter((s) => G.flag(s)).length;
    for (const s of shards) G.lit(s, !G.flag(s));
    while (got() < 3) {
      const left = shards.filter((s) => !G.flag(s));
      G.objective(`Find the Sun Shards (${got()}/3)`, left);
      const id = await G.reachAny(left.map((s) => [s, S[s]]), 14);
      const p = S[id];
      G.bark("tobi", ["Shades! Guarding the shard!", "Ooh, I don't like this glade.", "Last one! Stay sharp!"][got()]);
      const foes = id === "shardC" ? [["shade", p[0] - 5, p[1] + 3], ["shade", p[0] + 5, p[1] + 3], ["wisp", p[0], p[1] - 6], ["wisp", p[0] + 6, p[1] - 3]] : [["shade", p[0] - 4, p[1] + 4], ["wisp", p[0] + 5, p[1]], ["wisp", p[0] - 3, p[1] - 5]];
      await G.fight(foes);
      await G.interactAny([id], "Take the Sun Shard");
      G.flag(id, true); G.lit(id, false); G.sfx("item");
      G.give("shard");
      if (got() === 1) await G.say([{ w: "tobi", t: "Warm as a sunbeam on a nap rock. One down!", m: "happy" }]);
      if (got() === 2) await G.say([{ w: "mira", t: "Tobi… why are the shades guarding these? Vesper wants light, not to hide it." }, { w: "tobi", t: "Maybe the King's afraid of what light does to his shadows. Just a theory. A smart, handsome theory." }]);
      G.checkpoint(3);
    }
    G.checkpoint(4);
  }
  if (G.from <= 4) {
    G.objective("Bring the shards to the forest shrine", S.shrine);
    await G.reach(S.shrine, 5);
    await G.interactAny(["shrine"], "Place the Sun Shards");
    G.lit("shrine", true); G.sfx("light"); G.flash(0.5);
    await G.wait(0.8);
    G.npc("morrow", "morrow", S.morrow, -Math.PI / 2);
    G.fx("smoke", [...S.morrow, 0]); G.sfx("vesper");
    G.focus("morrow");
    await G.say([
      { w: "morrow", t: "The shrine wakes. The King said a spark would come crawling down this road." },
      { w: "tobi", t: "Black armour. Big sword. Mira, this is the 'just run' guy!", m: "shock" },
      { w: "morrow", t: "Give me the staff, child. I will make it quick. I was… kind, once. I think." },
      { w: "mira", t: "You'll have to take it.", m: "angry" },
    ]);
    G.focus(null);
    G.hint("Boss: watch for the red warnings — dodge (Space) through his swings, strike after he recovers");
    await G.fight([["morrow", S.morrow[0], S.morrow[1]]], { boss: "Morrow, the Shadow Knight", hp: 320 });
    G.checkpoint(5);
  }
  if (G.from <= 5) {
    G.lit("shrine", true);
    G.npcIf("morrow", S.morrow); G.act("morrow", "kneel", 9);
    G.focus("morrow");
    await G.say([
      { w: "morrow", t: "The light… it burns… but it is warm. Why is it warm?", m: "sad" },
      { w: "morrow", t: "The King… will have his lantern. You cannot… stop the dark…" },
    ]);
    G.fx("smoke", [...S.morrow, 0]); G.remove("morrow"); G.focus(null);
    G.drop("locket", S.morrow);
    G.objective("Pick up what the knight dropped", S.morrow);
    await G.interactAny(["locket"], "Pick up");
    G.sfx("item");
    await G.say([
      { w: "mira", t: "A silver locket. There's an engraving… 'A. Rook'.", m: "shock" },
      { w: "tobi", t: "Rook. Like your captain back home?" },
      { w: "mira", t: "He said his brother was taken by the Hollow on the north road… Aldric.", m: "sad" },
      { w: "tobi", t: "So the scary knight is somebody's little brother. I hate it when villains have families." },
    ]);
    G.lit("shrineThorns", false);
    G.objective("Take the east road toward the Black River", S.exit);
    await G.reach(S.exit, 6);
    await G.endChapter();
  }
}

// ------------------------------------------------------------------ Chapter III
async function chapter3(G) {
  const S = G.map.spots;
  G.npc("tobi", "tobi", [S.start[0] + 1.5, S.start[1] - 1], Math.PI / 2); G.follow("tobi");
  G.npc("oswin", "oswin", S.oswin, -Math.PI / 2);
  G.chatter("oswin", [[{ w: "oswin", t: "Braziers, lass. Four of 'em. Then the chain lets go." }]]);
  if (G.from <= 0) {
    await G.chapterCard(2);
    await G.say([{ w: "tobi", t: "The Black River. Fun fact: it's black because it's full of drowned regrets." }, { w: "mira", t: "Is that true?" }, { w: "tobi", t: "No. It's mud. But it FEELS true." }]);
    G.checkpoint(1);
  }
  if (G.from <= 1) {
    G.objective("Find the ferryman at the dock", "oswin");
    await G.talkTo("oswin");
    await G.say([
      { w: "oswin", t: "Ferry's closed. Has been since the King's shadows chained her to the bank.", m: "sad" },
      { w: "mira", t: "Please. Vesper has my teacher. I have to cross tonight." },
      { w: "oswin", t: "...Bram's girl? Should've said. He pulled me out of this river forty years back." },
      { w: "oswin", t: "The flood braziers. Light all four and the old chain-spell breaks. Three sit out on the islands — mind the planks." },
      { w: "oswin", t: "Fourth's by the mill. And lass… the river shades hate fire. They'll come." },
    ]);
    G.checkpoint(2);
  }
  if (G.from <= 2) {
    const bz = ["b1", "b2", "b3", "b4"];
    const n = () => bz.filter((b) => G.isLit(b)).length;
    while (n() < 4) {
      const left = bz.filter((b) => !G.isLit(b));
      G.objective(`Light the flood braziers (${n()}/4)`, left);
      const id = await G.interactAny(left, "Light the brazier");
      G.lit(id, true); G.sfx("light");
      if (id === "b2" || id === "b4") { const p = S[id]; G.bark("tobi", "They're coming out of the water!"); await G.fight(id === "b2" ? [["shade", p[0] - 4, p[1] - 12], ["wisp", p[0] + 3, p[1] - 10], ["wisp", p[0] - 6, p[1] - 9]] : [["shade", p[0] - 6, p[1] - 4], ["shade", p[0] + 2, p[1] - 8], ["wisp", p[0] - 2, p[1] + 2]]); }
    }
    G.flash(0.4); G.sfx("chain");
    await G.say([{ w: "oswin", t: "Hear that? The chain's singing. She's free!", m: "happy" }, { w: "oswin", t: "River's still running wild, though. Give it time. While you wait — the old mill. Bram stayed there, years back. Might be something of his." }]);
    G.checkpoint(3);
  }
  if (G.from <= 3) {
    for (const b of ["b1", "b2", "b3", "b4"]) G.lit(b, true);
    G.objective("Search the old mill", S.journal);
    await G.interactAny(["journal"], "Read the journal");
    G.sfx("page");
    await G.say([
      { w: "bram", t: "(Bram's journal) 'Vesper came to me at twelve, afraid of every shadow. I thought I could teach the fear out of him.'" },
      { w: "bram", t: "'I taught him lamps and wicks and patience. He wanted more. He wanted a light that could never go out.'" },
      { w: "bram", t: "'Tonight he tried to bottle the sunrise. The light took something from him in return — his warmth, his colour. He calls himself hollow now.'" },
      { w: "bram", t: "'He ran into the dark, and I let him go. That is my failure, not his. If he ever returns… I must not meet him with a blade.'" },
      { w: "mira", t: "Bram… you never told me any of this.", m: "sad" },
      { w: "tobi", t: "Wait. Mira. Do you hear armour?", m: "shock" },
    ]);
    G.checkpoint(4);
  }
  if (G.from <= 4) {
    G.npc("morrow", "morrow", S.morrow, Math.PI / 2);
    G.fx("smoke", [...S.morrow, 0]); G.sfx("vesper");
    G.focus("morrow");
    await G.say([{ w: "morrow", t: "The spark again. The King grows impatient, and so do I." }, { w: "mira", t: "I found your locket. Your name is Aldric Rook!" }, { w: "morrow", t: "...That name is drowned. Like everything else.", m: "angry" }]);
    G.focus(null);
    await G.fight([["morrow", S.morrow[0], S.morrow[1]]], { boss: "Morrow, the Shadow Knight", hp: 420, until: 0.45 });
    G.npc("rook", "rook", S.rookIn, Math.PI / 2);
    G.sfx("horn");
    G.focus("rook");
    await G.say([
      { w: "rook", t: "ALDRIC!", m: "shock" },
      { w: "rook", t: "I left the gate the moment the lanterns died. Mira — that's my brother in there. I'd know his stance anywhere." },
      { w: "morrow", t: "Brother…? No. No, the King said no one was looking. He said no one ever came.", m: "sad" },
      { w: "rook", t: "I've looked every autumn for nine years! Help me, Mira — break that cursed armour. Use the light!" },
    ]);
    G.focus(null);
    G.follow("rook", true);
    G.hint("Crack his armour: Light Bursts (K) deal triple damage to Morrow now");
    await G.fight([["morrow", S.morrow[0], S.morrow[1]]], { boss: "Morrow, the Shadow Knight", hp: 420, resume: 0.45, burstBonus: 3 });
    G.checkpoint(5);
  }
  if (G.from <= 5) {
    G.npcIf("rook", [S.morrow[0] - 3, S.morrow[1] - 2]);
    G.npcIf("morrow", S.morrow); G.act("morrow", "kneel", 9);
    G.focus("morrow");
    G.flash(0.7); G.sfx("shatter");
    G.swap("morrow", "aldric");
    await G.say([
      { w: "aldric", t: "...Ned? Ned, you got old.", m: "sad" },
      { w: "rook", t: "And you got stupid. Nine years, Aldric!", m: "sad" },
      { w: "aldric", t: "The King found me lost on the north road. He promised I'd never be afraid again. He just… took the part of me that could feel it." },
      { w: "aldric", t: "Apprentice. I hurt you. I hurt a great many people. You have every right to end this." },
      { choice: [["Come with us. Help us stop Vesper.", "spare"], ["Go home to Willowmere. Your fight is over.", "home"]] },
    ]).then((c) => G.flag("spared", c === "spare"));
    if (G.flag("spared")) { await G.say([{ w: "aldric", t: "Then my sword is yours. I know the Spire's halls — and its master's weaknesses." }, { w: "rook", t: "We all go, then. Together.", m: "happy" }]); G.follow("aldric", true); }
    else { await G.say([{ w: "aldric", t: "…Thank you. I'll keep the gate's lamps lit until you return." }, { w: "rook", t: "And I'm coming with you, Mira. Someone has to bring you all home.", m: "happy" }]); G.remove("aldric"); }
    G.focus(null);
    G.follow("rook", true);
    G.checkpoint(6);
  }
  if (G.from <= 6) {
    if (G.flag("spared")) { G.npcIf("aldric", [S.dock[0] + 2, S.dock[1] - 4]); G.follow("aldric", true); }
    G.npcIf("rook", [S.dock[0] - 2, S.dock[1] - 4]); G.follow("rook", true);
    G.objective("Board Oswin's ferry", S.dock);
    await G.reach(S.dock, 3.5);
    await G.say([{ w: "oswin", t: "All aboard who's going to the end of the world. Hold the rail and don't look down.", m: "happy" }, { w: "tobi", t: "Why not look down?" }, { w: "oswin", t: "Because the river looks back." }, { w: "tobi", t: "I HATE it here.", m: "shock" }]);
    await G.endChapter();
  }
}

// ------------------------------------------------------------------ Chapter IV
async function chapter4(G) {
  const S = G.map.spots;
  const st = S.start;
  G.npc("tobi", "tobi", [st[0] + 1.5, st[1] - 1], Math.PI / 2); G.follow("tobi");
  G.npc("rook", "rook", [st[0] - 1.8, st[1] - 1.5], Math.PI / 2); G.follow("rook", true);
  if (G.flag("spared")) { G.npc("aldric", "aldric", [st[0] + 3, st[1] - 2.5], Math.PI / 2); G.follow("aldric", true); }
  if (G.from <= 0) {
    await G.chapterCard(3);
    await G.say([
      { w: "rook", t: "The Hollow Spire. Every light he stole is up there… and the sun's gone black in the sky.", m: "shock" },
      ...(G.flag("spared") ? [{ w: "aldric", t: "The road spirals up the mountain. His guard waits at every turn. Brutes, too — big ones. Don't let them corner you." }] : []),
      { w: "tobi", t: "I'd like it on record that I was brave. I'm saying it now in case I'm not later." },
      { w: "mira", t: "Noted, Tobi. Let's go get Bram.", m: "happy" },
    ]);
    G.checkpoint(1);
  }
  if (G.from <= 1) {
    G.objective("Climb the spiral road", S.w1);
    await G.reach(S.w1, 9);
    G.bark("rook", "Shields up!");
    await G.fight([["shade", S.w1[0] + 3, S.w1[1] + 2], ["shade", S.w1[0] - 3, S.w1[1] - 3], ["wisp", S.w1[0], S.w1[1] + 5], ["wisp", S.w1[0] + 5, S.w1[1] - 2]]);
    G.objective("Climb the spiral road", S.w2);
    await G.reach(S.w2, 9);
    G.bark("tobi", "That one's HUGE!");
    await G.fight([["brute", S.w2[0], S.w2[1]], ["wisp", S.w2[0] + 4, S.w2[1] + 3], ["wisp", S.w2[0] - 4, S.w2[1] - 3]]);
    G.checkpoint(2);
  }
  if (G.from <= 2) {
    G.lit("cage", true);
    G.npc("bram", "bram", S.cage, 0); G.act("bram", "kneel", 99);
    G.objective("Free Bram from the dark cage", S.cage);
    await G.interactAny(["cage"], "Break the cage");
    G.lit("cage", false); G.flash(0.5); G.sfx("shatter");
    G.act("bram", "wave", 1.5);
    await G.say([
      { w: "bram", t: "Mira…? You came all this way. Through the woods, the river — you foolish, wonderful girl.", m: "happy" },
      { w: "mira", t: "You'd have done the same.", m: "happy" },
      { w: "bram", t: "I'd have done it slower. My knees, you know." },
      { w: "bram", t: "Listen. Vesper isn't a monster. He's a boy who was frightened so long that he forgot how to be anything else." },
      { w: "bram", t: "His shadows shield him. Only true light breaks through — the Sunstaff's burst. When his shield cracks, strike." },
    ]);
    G.follow("bram", true);
    G.objective("Reach the summit", S.w3);
    await G.reach(S.w3, 9);
    await G.fight([["brute", S.w3[0], S.w3[1]], ["shade", S.w3[0] + 4, S.w3[1]], ["shade", S.w3[0] - 4, S.w3[1]], ["wisp", S.w3[0], S.w3[1] + 5]]);
    G.checkpoint(3);
  }
  if (G.from <= 3) {
    G.npcIf("bram", [S.summit[0] - 3, S.summit[1] - 6]); G.follow("bram", true);
    G.objective("Confront the Hollow King", S.summit);
    await G.reach(S.summit, 6);
    G.npc("vesper", "vesper", S.vesper, -Math.PI / 2);
    G.focus("vesper"); G.sfx("vesper");
    await G.say([
      { w: "vesper", t: "Teacher. You brought an audience. How fitting — they can watch the last sunrise." },
      { w: "bram", t: "Vesper, look at the sky. You've not bottled the sun. You've smothered it." },
      { w: "vesper", t: "I have SAVED it! No more dusk, no more night, no more waiting in the dark for someone to come!", m: "angry" },
      { w: "mira", t: "Nobody came for you. I know. Bram's journal… he wrote that he let you go. That he was wrong to." },
      { w: "vesper", t: "...He wrote that?", m: "shock" },
      { w: "vesper", t: "It changes nothing. Words are candles. I am the eclipse.", m: "angry" },
    ]);
    G.focus(null);
    G.hint("Vesper's shadow shield is immune to strikes — break it with a Light Burst (K), then attack!");
    await G.fight([["vesper", S.vesper[0], S.vesper[1]]], { boss: "Vesper, the Hollow King", hp: 900 });
    G.checkpoint(4);
  }
  if (G.from <= 4) {
    G.npcIf("vesper", S.vesper); G.act("vesper", "kneel", 99);
    G.npcIf("bram", [S.vesper[0] - 2.5, S.vesper[1] - 4]);
    G.focus("vesper");
    await G.say([
      { w: "vesper", t: "It's so cold without the shadows. I can't… I don't remember how to be warm.", m: "sad" },
      { w: "bram", t: "Then let me remind you. I'm sorry, Vesper. I should have followed you into the dark. I should have brought a lamp.", m: "sad" },
      { w: "vesper", t: "...Teacher." },
      { choice: [["Come home with us, Vesper.", "forgive"], ["The valley will decide what you're owed.", "justice"]] },
    ]).then((c) => G.flag("forgave", c === "forgive"));
    await G.say(G.flag("forgave") ? [{ w: "vesper", t: "Home. I'd… like to see a sunrise. A real one. Not mine.", m: "sad" }] : [{ w: "vesper", t: "That is fair. More than fair. I will answer for every light.", m: "sad" }]);
    G.focus(null);
    G.objective("Release the stolen sun — use the Spire's heart", S.arena);
    await G.interactAny(["heart"], "Release the light");
    G.flash(1.2); G.sfx("sunrise");
    G.setEnv("dawn", 7);
    await G.wait(2.5);
    G.act("tobi", "cheer", 4); G.act("rook", "cheer", 4); if (G.flag("spared")) G.act("aldric", "cheer", 4); G.act("bram", "wave", 3);
    await G.say([
      { w: "tobi", t: "THE SUN! The actual, real, warm, wonderful sun!", m: "happy" },
      { w: "rook", t: "Every lamp in the valley — look! They're lighting themselves!", m: "happy" },
      { w: "bram", t: "No, Captain. The light is simply going home. As are we.", m: "happy" },
      { w: "bram", t: "Mira. The valley will need a new Lantern Keeper. My knees and I have decided to retire." },
      { w: "mira", t: "You mean…", m: "shock" },
      { w: "bram", t: "Keeper Mira of Willowmere. Light the lamps every year. And when someone is lost in the dark…" },
      { w: "mira", t: "...Bring a lamp. And go after them.", m: "happy" },
    ]);
    await G.ending();
  }
}
