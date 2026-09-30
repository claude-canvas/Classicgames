// Shaders for Vortex. Same attributes, uniforms and projection maths as Space.js,
// so Space.reDraw() drives them unchanged. The 4th component of `pos` is a material id:
//   1 = obstacle (colour pre-shaded on the CPU, col.a = neon rim amount)
//   2 = tunnel wall (pattern built in the fragment shader, rotated here by uRoll)
//   4 = craft (lit on the CPU, no fog)
//   5 = emissive (orbs, sparks, speed streaks)

export const VERT = `
attribute vec4 pos;
attribute vec4 col;

uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;      // (zShifter, magnifier, unused) - set by Space

uniform vec2 uAspect;        // screen-shape correction so the canvas can fill any screen
uniform float uRoll;         // tunnel spin (the player always sits at the bottom)
uniform vec3 uBend;          // (bend x, bend z, bend start y)

varying vec4 vCol;
varying vec2 vTube;          // unrolled tunnel x/z, for the wall pattern
varying float vY;
varying float vMat;
varying float vDepth;

void main() {
    vec3 w = pos.xyz;
    float mat = pos.w;
    vCol = col;
    vMat = mat;
    vTube = pos.xz;
    vY = pos.y;

    if (mat > 1.5 && mat < 2.5) {
        float c = cos(uRoll), s = sin(uRoll);
        w = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
    }

    // the tunnel snakes away from you: purely visual, gameplay stays straight
    float d = max(w.y - uBend.z, 0.0);
    w.x += uBend.x * d * d;
    w.z += uBend.y * d * d;

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
varying vec2 vTube;
varying float vY;
varying float vMat;
varying float vDepth;

uniform float fTime;
uniform float fScroll;       // distance travelled (wrapped)
uniform float fBeat;         // 0..1 pulse
uniform float fHit;          // red flash after a crash
uniform vec3 fColA;          // zone neon colours
uniform vec3 fColB;
uniform vec3 fFog;
uniform vec2 fFogRange;

const float PI = 3.14159265;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float line(float x, float w) {
    float d = abs(fract(x) - 0.5) * 2.0;           // 1 on the line, 0 halfway between lines
    return 1.0 - smoothstep(w, w * 1.8 + 0.015, 1.0 - d);
}

vec3 wall() {
    float a = atan(vTube.y, vTube.x);               // -PI..PI, fixed to the tunnel
    float u = a / (2.0 * PI) * 16.0;                // 16 panels around
    float v = (vY + fScroll) / 6.0;                 // a ring every 6 units
    float aa = clamp(vDepth * 0.0025, 0.01, 0.25);  // wider lines far away so they don't shimmer

    vec2 cell = vec2(floor(u), floor(v));
    float h = hash(cell);
    vec3 c = vec3(0.012, 0.014, 0.04);
    // a few panels glow softly, flickering with the beat
    if (h > 0.86) c += fColB * (0.16 + 0.1 * fBeat) * (0.5 + 0.5 * sin(fTime * 3.0 + h * 40.0));
    else if (h > 0.7) c += fColA * 0.05;

    float grid = max(line(u, 0.018 + aa * 0.6), line(v, 0.015 + aa * 0.6));
    c += fColA * grid * 0.6;

    // bright light rings every 48 units, and a pulse that races toward you
    float ring = line((vY + fScroll) / 48.0, 0.012 + aa * 0.05);
    c += fColB * ring * 1.4;
    float pulse = line((vY + fScroll * 1.0 + fTime * 60.0) / 96.0, 0.01 + aa * 0.04);
    c += fColA * pulse * 0.6;

    // floor strip under the craft
    c *= 0.75 + 0.25 * smoothstep(-0.2, -1.0, sin(a));
    return c;
}

void main() {
    vec3 c = vCol.rgb;
    float fogK = 1.0;
    if (vMat > 1.5 && vMat < 2.5) {
        c = wall();
    } else if (vMat < 1.5) {
        // obstacles: neon rim along their inner edge
        c += fColB * smoothstep(0.82, 1.0, vCol.a) * (1.1 + 0.5 * fBeat);
    } else if (vMat > 3.5 && vMat < 4.5) {
        fogK = 0.0;
    } else {
        fogK = 0.45;
    }
    float f = smoothstep(fFogRange.x, fFogRange.y, vDepth) * fogK;
    c = mix(c, fFog, f);
    c += vec3(0.6, 0.05, 0.08) * fHit;
    gl_FragColor = vec4(c, 1.0);
}`;
