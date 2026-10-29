// Frost Stone: runs the CPU skip's search off the main thread so the render loop never hitches.
import { chooseShot } from "./ai.js";
onmessage = (e) => { const { id, stones, team, noise } = e.data; postMessage({ id, shot: chooseShot(stones, team, noise) }); };
