# Marble Gambit — design & hand-off document

> Chess in 3D: carved white-marble and black-obsidian pieces on a veined stone board in a moonlit glass
> conservatory. A real engine (alpha-beta search in a Web Worker) with five strengths, full rules, a move list
> in standard notation, clocks, hints, undo, captured-material tray and board flip.
> Built on the arcade's own `Space.js`. Everything lives in `public/marble-gambit/`; do not edit outside it.

## 1. Rules (`chess.js`, pure)
Full FIDE movement: castling (rights + no castling through/out of check), en passant, promotion (choice of
piece), check, checkmate, stalemate, fifty-move rule, threefold repetition, insufficient material.
Board = 64-int array (a8 = 0 … h1 = 63), white pieces positive (P1 N2 B3 R4 Q5 K6), black negative.
`moves()` → legal moves; `make/undo`; `san(move)`; `fen()`; `status()`.

## 2. Engine (`engine.js` + `worker.js`)
Negamax alpha-beta, iterative deepening with a time budget, quiescence search on captures, MVV-LVA ordering
plus the previous best move first, material + piece-square tables (mid-game / end-game king tables blended by
remaining material). Runs in a module Web Worker so the UI never freezes; falls back to the main thread.
Strength: Novice (depth 1, 35 % random among decent moves) · Casual (2) · Club (3) · Expert (4, 1.2 s) ·
Master (6, 2.5 s).

## 3. Presentation
- Pieces: lathe-turned profiles for pawn/rook/bishop/queen/king (rook crenellations, bishop mitre slit,
  queen coronet, king cross); the knight is a sculpted head built from an extruded side profile with bevels.
- Materials: white marble with soft blue-grey veins and subsurface glow; black obsidian with sharp reflections
  and a faint violet sheen. Board: alternating cream marble and dark green serpentine, brass edging, engraved
  coordinates.
- Room: a glass conservatory at night — moonlight through the panes, potted palms, candles, a fountain glow.
- Moves animate: pieces lift, glide (knights hop) and settle with a click; captured pieces sink into the tray.
- Highlights: selected square, legal destinations (dots / capture rings), last move, check (red pulse on the
  king), hint arrow.

## 4. UI
Title (logo, side choice white/black/random, strength 1–5, time control: untimed / 10+0 / 5+3 / 3+2) · HUD:
two player plates (name, clock, captured pieces, material +N), move list (SAN, scrollable), action bar
(Undo, Hint, Flip, Resign/New) · Promotion picker · Game over modal (result, reason, moves) · Settings
(sound, show legal moves, auto-queen, piece animation speed).

## 5. Files
`DESIGN.md` · `index.html` · `GameSpace.js` `mesh.js` `post.js` · `shaders.js` · `chess.js` (rules) ·
`engine.js` (search) · `worker.js` (worker wrapper) · `pieces.js` (models) · `scene.js` (board + room) ·
`audio.js` · `main.js`.

## 6. Debug
`?autoplay` engine vs engine · `?level=3` · `?fen=...` · `window.__chess()`.

## 7. Progress log
- v1: implemented in full. chess.js passes perft on 5 standard positions (start to depth 4 = 197,281,
  Kiwipete, positions 3–5) — the move generator is exact. The engine finds mates/tactics, Club beats Casual
  in self-play, Master reaches depth 5 in 2.5 s. Runs in a module Web Worker.
- Pieces are cached in their own GPU buffer and rebuilt only when something moves (32 lathe pieces ≈ 85k
  vertices would otherwise be rebuilt every frame).
- Verified in headless Chrome: title, engine-vs-engine autoplay to move 17+, move list, captured trays.
- Camera framing: landscape distance ×1.14 and a 1.5-unit sideways shift so the HUD panel never covers the
  h-file. Verified at 1440×900 (move 11, SAN list correct). Status: complete.
