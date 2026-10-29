// Lumen Links: the bot's shot search runs off the main thread.
import { HOLES } from "./holes.js";
import { bestShot } from "./bot.js";
onmessage = (e) => { const { id, hi, x, y, t } = e.data; postMessage({ id, shot: bestShot(HOLES[hi], x, y, t, { angStep: 3, pows: 22, robust: false }) }); };
