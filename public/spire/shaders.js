// Shaders for Spire. Same attributes, uniforms and projection maths as Space.js, so Space.reDraw() drives them.
// pos.w packs material * 8 + face:  1 = glass slab (face 0 top, 1 bottom, 2 +x, 3 -x, 4 +y, 5 -y),
//                                   3 = sky and cloud sea (a full-screen quad), 5 = additive glow.
// For slabs, col = (u, v, slab index, glow). The slab colour comes from its index, so debris keeps its colour.

export function buildShaders() {
    const VERT = `
attribute vec4 pos;
attribute vec4 col;

uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;      // (zShifter, magnifier, unused) - set by Space
uniform vec2 uAspect;        // screen-shape correction so the canvas can fill any screen

varying vec4 vCol;
varying vec3 vW;
varying vec3 vDir;
varying float vMat;

void main() {
    vCol = col;
    vMat = pos.w;
    vW = pos.xyz;
    if (pos.w > 23.5 && pos.w < 24.5) {
        // sky: a screen quad whose per-corner view ray comes from Space's camera axes
        vDir = zAxis + xAxis * (pos.x * 1.6 / (veriables.y * uAspect.x)) + yAxis * (pos.y * 0.8 / (veriables.y * uAspect.y));
        gl_Position = vec4(pos.xy, 0.9999, 1.0);
        return;
    }
    vDir = vec3(0.0);
    vec3 rel = pos.xyz - cPoint;
    float xProj = dot(rel, xAxis);
    float yProj = dot(rel, yAxis);
    float zProj = dot(rel, zAxis);
    // identical to Space.js's projection, plus the aspect correction
    float maxWidth = max(abs(zProj * 0.1 / veriables.y), 0.0001);
    gl_Position = vec4(xProj / (maxWidth * 16.0) * uAspect.x,
                       yProj / (maxWidth * 8.0) * uAspect.y,
                       zProj / 800.0 - veriables.x, 1.0);
}`;

    const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec4 vCol;
varying vec3 vW;
varying vec3 vDir;
varying float vMat;

uniform vec3 fCam;
uniform float fTime;
uniform float fBeat;         // 0..1 pulse after every drop
uniform float fFlash;        // red wash when the tower falls
uniform vec3 fZen;           // sky colours, blended on the CPU as the tower climbs
uniform vec3 fHor;
uniform vec3 fHaze;          // cloud colour
uniform vec3 fLight;         // colour of the key light
uniform vec3 fKey;           // key light direction
uniform vec3 fSunDir;
uniform vec3 fMoonDir;
uniform vec4 fMix;           // sun, stars, aurora, moon
uniform float fCloudZ;       // height of the cloud tops

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p = p * 2.03 + vec2(17.1, 9.3);
        a *= 0.5;
    }
    return v;
}

vec3 palette(float t) {
    return vec3(0.56, 0.46, 0.6) + vec3(0.42, 0.42, 0.4) * cos(6.28318 * (vec3(1.0, 0.92, 0.84) * t + vec3(0.02, 0.27, 0.55)));
}

vec3 faceN(float f) {
    if (f < 0.5) return vec3(0.0, 0.0, 1.0);
    if (f < 1.5) return vec3(0.0, 0.0, -1.0);
    if (f < 2.5) return vec3(1.0, 0.0, 0.0);
    if (f < 3.5) return vec3(-1.0, 0.0, 0.0);
    if (f < 4.5) return vec3(0.0, 1.0, 0.0);
    return vec3(0.0, -1.0, 0.0);
}

// soft shoulder instead of a hard clip, so bright neon keeps its hue
vec3 shoulder(vec3 x) {
    vec3 lo = min(x, vec3(0.8));
    vec3 hi = max(x - 0.8, vec3(0.0));
    return lo + 0.2 * (vec3(1.0) - exp(-hi * 5.0));
}

vec3 sky(vec3 d) {
    float h = d.z;
    vec3 c = mix(fHor, fZen, pow(clamp(h, 0.0, 1.0), 0.5));
    c += fHor * exp(-abs(h) * 7.0) * 0.3;

    // stars
    if (fMix.y > 0.01 && h > -0.05) {
        vec3 p = d * 160.0;
        float hh = hash3(floor(p));
        if (hh > 0.972) {
            vec3 f = fract(p) - 0.5;
            float s = 1.0 - smoothstep(0.0, 0.2 + 0.2 * fract(hh * 91.0), length(f));
            float tw = 0.65 + 0.35 * sin(fTime * (1.0 + hh * 3.0) + hh * 60.0);
            c += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), fract(hh * 37.0)) * s * tw * fMix.y * smoothstep(-0.02, 0.2, h);
        }
    }

    // sun
    float sd = max(dot(d, fSunDir), 0.0);
    c += vec3(1.0, 0.82, 0.6) * (pow(sd, 900.0) * 7.0 + pow(sd, 60.0) * 0.5 + pow(sd, 6.0) * 0.14) * fMix.x;

    // moon
    float md = dot(d, fMoonDir);
    if (fMix.w > 0.01 && md > 0.97) {
        float disc = smoothstep(0.9988, 0.9993, md);
        vec3 mu = normalize(cross(fMoonDir, vec3(0.0, 0.0, 1.0)));
        vec3 mv = cross(mu, fMoonDir);
        vec2 q = vec2(dot(d, mu), dot(d, mv)) * 160.0;
        float cr = fbm(q + 4.0);
        c = mix(c, vec3(0.9, 0.93, 1.0) * (0.72 + 0.42 * cr), disc * fMix.w);
        c += vec3(0.5, 0.6, 1.0) * pow(max(md, 0.0), 150.0) * 0.35 * fMix.w;
    }

    // aurora curtains
    if (fMix.z > 0.01 && h > 0.0) {
        vec2 dir = d.xy / max(length(d.xy), 0.001);
        float w = fbm(dir * 1.8 + vec2(h * 3.0, fTime * 0.05));
        float band = smoothstep(0.35, 0.75, w) * smoothstep(0.02, 0.25, h) * (1.0 - smoothstep(0.35, 0.8, h));
        vec3 ac = mix(vec3(0.15, 1.0, 0.6), vec3(0.6, 0.3, 1.0), clamp(h * 2.0 + w * 0.5 - 0.2, 0.0, 1.0));
        c += ac * band * fMix.z * 0.85;
    }

    // the sea of clouds under the tower
    if (h < -0.002) {
        float tt = (fCloudZ - fCam.z) / h;
        vec2 p = (fCam.xy + d.xy * tt) * 0.04 + vec2(fTime * 0.006, fTime * 0.002);
        float n = fbm(p);
        float dens = smoothstep(0.35, 0.8, n);
        float n2 = fbm(p + fSunDir.xy * 0.12);
        float lit = clamp(0.55 + (n - n2) * 3.5, 0.0, 1.0);
        vec3 cl = mix(fHaze * 0.36, fHaze * 0.98 + vec3(1.0, 0.8, 0.6) * fMix.x * 0.16, lit);
        vec3 deep = fHor * 0.22 + fZen * 0.3;
        vec3 sea = mix(deep, cl, 0.3 + 0.7 * dens);
        c = mix(c, sea, smoothstep(0.0, -0.22, h));
    }
    return c;
}

vec3 slab(float face) {
    vec3 N = faceN(face);
    vec3 V = normalize(fCam - vW);
    float idx = vCol.b;
    float glow = vCol.a;
    float u = vCol.r;
    float v = vCol.g;
    bool pillar = idx < -0.5;
    vec3 base = pillar ? vec3(0.16, 0.17, 0.24) : palette(idx * 0.03);

    float diff = clamp(dot(N, fKey) * 0.5 + 0.5, 0.0, 1.0);
    diff *= diff;
    vec3 amb = mix(fHor, fZen, N.z * 0.5 + 0.5);
    vec3 c = base * (0.18 + amb * 0.75 + fLight * diff * 0.95);

    // glossy sheen and a glassy rim
    vec3 Hv = normalize(fKey + V);
    c += fLight * pow(max(dot(N, Hv), 0.0), 40.0) * 0.45;
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    c += mix(base, fLight, 0.45) * fr * 0.7;

    // luminous edges
    float e = min(min(u, 1.0 - u), min(v, 1.0 - v));
    float rim = 1.0 - smoothstep(0.0, 0.07, e);
    float rimSoft = 1.0 - smoothstep(0.0, 0.32, e);
    vec3 neon = mix(base, vec3(1.0), 0.45);
    if (face < 0.5) {
        c += base * rimSoft * 0.35;
        c += neon * rim * 0.95;
    } else {
        c *= 0.72 + 0.4 * v;
        c += neon * smoothstep(0.8, 0.97, v) * 0.55;
        c += neon * rim * 0.25;
    }
    c += base * (0.12 + 0.1 * fBeat);
    c += vec3(1.0, 0.96, 0.9) * glow * (0.2 + 0.8 * rimSoft);
    if (pillar) {
        c += fLight * (1.0 - smoothstep(0.0, 0.05, min(v, 1.0 - v))) * 0.5;
    }

    // the tower sinks into the clouds
    float below = smoothstep(fCloudZ + 2.0, fCloudZ - 5.0, vW.z);
    vec3 cloud = fHaze * 0.66 + fHor * 0.1;
    return mix(c, cloud, below);
}

void main() {
    float m = floor(vMat / 8.0 + 0.02);
    float face = floor(vMat - m * 8.0 + 0.5);
    vec3 c;
    if (m > 2.5 && m < 3.5) {
        c = sky(normalize(vDir));
    } else if (m > 0.5 && m < 1.5) {
        c = shoulder(slab(face));
    } else {
        gl_FragColor = vec4(vCol.rgb, 1.0);   // additive glow pass
        return;
    }
    c += vec3(0.5, 0.04, 0.06) * fFlash;
    gl_FragColor = vec4(c, 1.0);
}`;
    return { VERT, FRAG };
}
