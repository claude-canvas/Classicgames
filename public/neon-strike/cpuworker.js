// Neon Strike: the CPU bowler's search runs off the main thread.
import { plan } from "./cpu.js";
onmessage = (e) => { const { id, standing, skill } = e.data; postMessage({ id, shot: plan(standing, skill) }); };
