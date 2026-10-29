// Runs the engine off the main thread. Message in: { id, fen, opts } · out: { id, result }.
import { search } from "./engine.js";
self.onmessage = (e) => {
    const { id, fen, opts } = e.data;
    self.postMessage({ id, result: search(fen, opts) });
};
