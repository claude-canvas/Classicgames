// 8-ball rules: turns, groups, fouls, ball in hand, winning and losing. Pure — main.js calls `afterShot`
// with the finished shot record from physics.js and shows whatever message comes back.

import { isSolid, isStripe } from "./physics.js";

export class Match {
    constructor(players, practice = false) {
        this.players = players.map((p) => ({ ...p, group: null }));
        this.turn = 0; this.open = true; this.ballInHand = true; this.breakShot = true;
        this.winner = null; this.practice = practice; this.shots = 0;
        this.stats = this.players.map(() => ({ potted: 0, fouls: 0, shots: 0 }));
    }
    get current() { return this.players[this.turn]; }
    owns(p, n) { return p.group === "solids" ? isSolid(n) : p.group === "stripes" ? isStripe(n) : n !== 8 && n !== 0; }
    remaining(p, table) { return table.balls.filter((b) => !b.potted && b.n !== 0 && b.n !== 8 && (p.group ? this.owns(p, b.n) : false)).length; }
    onEight(p, table) { return !!p.group && this.remaining(p, table) === 0; }
    legalTargets(table) {
        const p = this.current;
        if (this.practice) return table.balls.filter((b) => !b.potted && b.n !== 0).map((b) => b.n);
        if (this.onEight(p, table)) return [8];
        return table.balls.filter((b) => !b.potted && b.n !== 0 && b.n !== 8 && this.owns(p, b.n)).map((b) => b.n);
    }

    afterShot(shot, table) {
        const p = this.current, st = this.stats[this.turn];
        st.shots++; this.shots++;
        const wasOnEight = this.onEight(p, { balls: table.balls.map((b) => (shot.potted.includes(b.n) ? { ...b, potted: false } : b)) });
        const pots = shot.potted, cuePot = pots.includes(0), eightPot = pots.includes(8);
        const objPots = pots.filter((n) => n !== 0 && n !== 8);
        st.potted += objPots.length;
        let foul = null;
        if (cuePot) foul = "Scratch — the cue ball went in";
        else if (shot.first == null) foul = "No ball was hit";
        else if (!this.practice) {
            if (wasOnEight && shot.first !== 8) foul = "You must hit the 8 first";
            else if (!wasOnEight && shot.first === 8) foul = "The 8 can't be hit first";
            else if (!this.open && !wasOnEight && !this.owns(p, shot.first)) foul = "Wrong group hit first";
        }
        const wasBreak = this.breakShot;
        this.breakShot = false; this.ballInHand = false;
        if (this.practice) {
            if (cuePot) { this.ballInHand = true; }
            if (eightPot && table.balls.filter((b) => !b.potted && b.n !== 0).length > 0) table.respot(8);
            return { foul, turnOver: false, message: foul ? "Scratch — ball in hand" : objPots.length ? `Potted ${objPots.length > 1 ? objPots.length + " balls" : "the " + objPots[0]}` : null };
        }
        // the 8
        if (eightPot) {
            if (wasBreak) { table.respot(8); }
            else {
                const win = wasOnEight && !foul;
                this.winner = win ? this.turn : 1 - this.turn;
                return { foul, win, end: true, message: win ? `${p.name} sinks the 8!` : foul ? `${p.name} fouls on the 8` : `${p.name} sank the 8 too early` };
            }
        }
        if (foul) {
            st.fouls++;
            this.turn = 1 - this.turn; this.ballInHand = true;
            return { foul, turnOver: true, message: `${foul}. ${this.current.name} has ball in hand.` };
        }
        // assign groups on the first legal pot
        let assigned = null;
        if (this.open && objPots.length && !wasBreak) {
            const g = isSolid(objPots[0]) ? "solids" : "stripes";
            p.group = g; this.players[1 - this.turn].group = g === "solids" ? "stripes" : "solids"; this.open = false;
            assigned = g;
        }
        const ownPotted = this.open ? objPots.length > 0 : objPots.some((n) => this.owns(p, n));
        if (ownPotted) return { turnOver: false, message: assigned ? `${p.name} takes ${assigned}` : null, assigned };
        this.turn = 1 - this.turn;
        return { turnOver: true, message: null };
    }
}
