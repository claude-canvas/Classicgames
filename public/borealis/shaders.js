// Shaders for Borealis. Same attributes, uniforms and projection maths as Space.js,
// so Space.reDraw() drives them unchanged. The 4th component of `pos` is a material id:
//   1 = lit object (colour pre-lit on the CPU)   2 = terrain (height + lighting built here)
//   3 = sky (aurora, sun, stars in the fragment) 5 = emissive (lanterns, embers, particles)

export const VERT = `
attribute vec4 pos;
attribute vec4 col;

uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;      // (zShifter, magnifier, unused) - set by Space

uniform vec2 uAspect;        // screen-shape correction so the canvas can fill any screen
uniform float uScroll;       // distance travelled, wrapped to the terrain period
uniform vec4 uWarp;          // (curve down, bend sideways, warp start y, time)
uniform vec3 uLight;

varying vec4 vCol;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vMat;
varying float vDepth;
varying float vShade;
varying float vHeight;

const float TAU = 6.2831853;
const float PERIOD = 240.0;  // terrain repeats every 240 units, so uScroll can wrap seamlessly
const float ROAD = 13.0;

float terrainH(vec2 p) {
    float ax = abs(p.x);
    float w = TAU / PERIOD;
    float valley = smoothstep(ROAD, ROAD + 34.0, ax);
    float n = 0.55 + 0.45 * sin(p.y * w * 4.0 + p.x * 0.07);
    n *= 0.65 + 0.35 * sin(p.y * w * 11.0 - p.x * 0.19 + 1.7);
    n += 0.3 * (0.5 + 0.5 * sin(p.y * w * 23.0 + p.x * 0.37));
    float ridge = 1.0 - abs(sin(p.x * 0.043 + p.y * w * 2.0));
    float far = smoothstep(40.0, 130.0, ax);
    return valley * (2.5 + n * 24.0 + ridge * ridge * 30.0 * far + far * 18.0);
}

void main() {
    vec3 w = pos.xyz;
    float mat = pos.w;
    vCol = col;
    vGrid = pos.xy;
    vShade = 1.0;
    vHeight = 0.0;

    if (mat > 1.5 && mat < 2.5) {
        // The mesh only ever shifts by less than one row; heights are sampled at row-aligned
        // coordinates, so mountains glide past without the vertices swimming over them.
        float frac = mod(uScroll, 5.0);
        vec2 sp = vec2(pos.x, pos.y + uScroll - frac);
        float h = terrainH(sp);
        float e = 1.2;
        float hx = terrainH(sp + vec2(e, 0.0)) - terrainH(sp - vec2(e, 0.0));
        float hy = terrainH(sp + vec2(0.0, e)) - terrainH(sp - vec2(0.0, e));
        vec3 n = normalize(vec3(-hx, -hy, 2.0 * e));
        vShade = 0.3 + 0.7 * max(dot(n, uLight), 0.0);
        vHeight = h;
        vGrid = sp;
        w = vec3(pos.x, pos.y - frac, h);
    }

    // Curved world: past the glider everything bends down (a small planet) and sideways
    // (the river turns). Purely visual, so gameplay positions stay simple.
    if (mat < 2.5 || mat > 3.5) {
        float d = max(w.y - uWarp.z, 0.0);
        w.z -= uWarp.x * d * d;
        w.x += uWarp.y * d * d;
    }

    vWorld = w;
    vMat = mat;

    vec3 rel = w - cPoint;
    float xProj = dot(rel, xAxis);
    float yProj = dot(rel, yAxis);
    float zProj = dot(rel, zAxis);
    vDepth = zProj;

    // identical to Space.js's projection, plus the aspect correction
    float maxWidth = max(abs(zProj * 0.1 / veriables.y), 0.0001);
    gl_Position = vec4(xProj / (maxWidth * 16.0) * uAspect.x,
                       yProj / (maxWidth * 8.0) * uAspect.y,
                       zProj / 800.0 - veriables.x, 1.0);
}`;

export const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec4 vCol;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vMat;
varying float vDepth;
varying float vShade;
varying float vHeight;

uniform float fTime;
uniform float fBeat;
uniform vec3 fFog;
uniform vec2 fFogRange;
uniform vec2 fShip;          // glider x, height above its hover line

const float ROAD = 13.0;
const float HORIZON = -103.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 auroraBand(float x, float z, float t, float base, float seed) {
    float zc = base + 26.0 * sin(x * 0.0031 + t * 0.07 + seed) + 12.0 * sin(x * 0.0097 - t * 0.19 + seed * 2.0);
    float dz = z - zc;
    float body = smoothstep(-14.0, 0.0, dz) * exp(-max(dz, 0.0) / 85.0);
    float rays = 0.5 + 0.5 * sin(x * 0.05 + 2.4 * sin(x * 0.011 + t * 0.33 + seed) + t * 0.45);
    rays = 0.3 + 0.7 * rays * rays;
    float fold = 0.55 + 0.45 * sin(x * 0.0052 - t * 0.12 + seed * 3.0);
    vec3 c = mix(vec3(0.28, 1.0, 0.6), vec3(0.6, 0.4, 1.0), clamp(dz / 140.0, 0.0, 1.0));
    return c * body * rays * fold;
}

vec3 aurora(float x, float z) {
    return auroraBand(x, z, fTime, 40.0, 0.0) * 0.9 + auroraBand(x + 900.0, z, fTime * 1.3, 95.0, 1.7) * 0.45;
}

vec3 sky(vec3 p) {
    float h = (p.z - HORIZON) / 330.0;
    vec3 c = fFog;
    if (h > 0.0) {
        c = mix(fFog, vec3(0.09, 0.12, 0.31), smoothstep(0.0, 0.3, h));
        c = mix(c, vec3(0.015, 0.02, 0.07), smoothstep(0.25, 1.0, h));
        c += vec3(1.0, 0.62, 0.5) * 0.16 * exp(-h * 14.0);
    }
    // low polar sun sitting on the mountains
    vec2 q = vec2(p.x - 250.0, p.z - HORIZON - 16.0);
    float r = length(q);
    c += vec3(1.0, 0.56, 0.42) * 0.5 * exp(-r / 130.0);
    c = mix(c, vec3(1.0, 0.9, 0.78), 1.0 - smoothstep(40.0, 43.0, r));
    // stars
    vec2 cell = floor(p.xz / 7.0);
    float s = hash(cell);
    if (s > 0.985) {
        vec2 f = fract(p.xz / 7.0) - 0.5;
        float tw = 0.55 + 0.45 * sin(fTime * 2.5 + s * 90.0);
        c += vec3(0.85, 0.9, 1.0) * (1.0 - smoothstep(0.08, 0.2, length(f))) * tw * smoothstep(0.2, 0.55, h);
    }
    return c + aurora(p.x, p.z);
}

vec3 terrain() {
    float ax = abs(vGrid.x);
    float hN = clamp(vHeight / 48.0, 0.0, 1.0);

    float snow = max(smoothstep(0.2, 0.42, hN), 1.0 - smoothstep(ROAD, ROAD + 8.0, ax));
    snow *= smoothstep(0.32, 0.55, vShade);
    vec3 rock = mix(vec3(0.06, 0.08, 0.17), vec3(0.15, 0.18, 0.32), hN);
    vec3 land = mix(rock, vec3(0.84, 0.9, 1.0), snow) * vShade;

    // frozen river: aurora reflected in the ice, frost lines and hairline cracks
    float fres = smoothstep(8.0, 140.0, vDepth);
    vec3 ice = vec3(0.05, 0.17, 0.27);
    ice += aurora(vWorld.x * 3.0, 70.0 + 30.0 * sin(vGrid.y * 0.02)) * (0.18 + 0.4 * fres);
    float lw = 0.04 + vDepth * 0.0025;
    float fy = abs(fract(vGrid.y / 10.0) - 0.5) * 10.0;
    ice += vec3(0.5, 0.75, 0.9) * (1.0 - smoothstep(lw, lw * 3.0, fy)) * 0.12;
    float crack = abs(sin(vGrid.x * 0.9 + 3.0 * sin(vGrid.y * 0.17)) * sin(vGrid.y * 0.23 - vGrid.x * 0.3));
    ice += vec3(0.6, 0.85, 1.0) * (1.0 - smoothstep(0.0, 0.06, crack)) * 0.18 * (1.0 - fres);
    float bank = smoothstep(ROAD - 2.2, ROAD - 0.2, ax);
    vec3 river = mix(ice, vec3(0.78, 0.86, 0.98) * (0.75 + 0.25 * vShade), bank);

    vec3 c = ax < ROAD ? river : land;

    // warm pools of light under the lanterns (one every 20 units on each bank)
    float ly = abs(fract(vGrid.y / 20.0 + 0.5) - 0.5) * 20.0;
    float lx = ax - 15.5;
    c += vec3(1.0, 0.62, 0.3) * exp(-(lx * lx + ly * ly) / 22.0) * (0.5 + 0.25 * fBeat);

    // the glider's engine light on the ice
    vec2 sd = vec2(vWorld.x - fShip.x, vWorld.y);
    c += vec3(0.3, 1.0, 0.75) * 0.35 * exp(-dot(sd, sd) / (7.0 + fShip.y * 5.0)) / (1.0 + fShip.y * 0.5);
    return c;
}

void main() {
    if (vMat > 2.5 && vMat < 3.5) {
        gl_FragColor = vec4(sky(vWorld), 1.0);
        return;
    }
    vec3 c = vCol.rgb;
    float fogAmt = 1.0;
    if (vMat > 1.5 && vMat < 2.5) {
        c = terrain();
    } else if (vMat > 4.5) {
        fogAmt = 0.75;
    }
    float f = smoothstep(fFogRange.x, fFogRange.y, vDepth) * fogAmt;
    gl_FragColor = vec4(mix(c, fFog, f), 1.0);
}`;
