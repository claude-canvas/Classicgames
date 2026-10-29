// Marble Gambit scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables). col.a = material, pos.w = per-material data.
//
//   0 MATTE   wood, stone floor, leaves · 1 GLOSS brass, glass frames, lacquer
//   2 MARBLE  veined marble (white pieces, board squares): veins + soft subsurface + polish
//   3 BG      night sky seen through the conservatory glass
//   4 SPRITE  additive glow (pos.w = size + corner·100) · 5 EMIT emissive (candle flames, moon)
//   6 SHADOW  multiply contact shadow (pos.w = u·2 + v, col.r = strength) · 7 ADD additive (highlights)
//   8 OBSIDIAN black volcanic glass: dark body, sharp reflections of the moonlit room, violet sheen
// Moonlight comes from the window (cool key light); candles are warm point lights.

export const NEAR = 0.2, FAR = 300.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 6.0) {
        float u = step(1.5, pos.w);
        vUV = vec2(u, pos.w - 2.0 * u);
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float N = ${NEAR.toFixed(2)}, F = ${FAR.toFixed(1)};
    gl_Position = vec4(xp * k, yp * k * aspect, zp * (F + N) / (F - N) - 2.0 * F * N / (F - N), zp);
}`;

export const FRAG = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
uniform float uLightCount;

const vec3 MOON_DIR = vec3(-0.42, 0.55, 0.72);
const vec3 MOONC = vec3(0.62, 0.72, 0.98);
const vec3 AMB = vec3(0.05, 0.055, 0.08);

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.5); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    float a = fract(sin(n) * 43758.5), b = fract(sin(n + 1.0) * 43758.5), c = fract(sin(n + 57.0) * 43758.5), d = fract(sin(n + 58.0) * 43758.5);
    float e = fract(sin(n + 113.0) * 43758.5), g = fract(sin(n + 114.0) * 43758.5), h = fract(sin(n + 170.0) * 43758.5), k = fract(sin(n + 171.0) * 43758.5);
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * 0.65 + noise(p * 2.03) * 0.35; }

vec3 room(vec3 d) {                                       // what polished surfaces reflect: dark room, moonlit window, candles
    vec3 c = vec3(0.02, 0.025, 0.04) + vec3(0.05, 0.06, 0.1) * max(d.z, 0.0);
    c += MOONC * 1.2 * smoothstep(0.75, 0.9, dot(d, normalize(MOON_DIR)));
    c += vec3(1.0, 0.6, 0.3) * 0.7 * smoothstep(0.93, 0.99, dot(d, normalize(vec3(0.6, -0.3, 0.3))));
    return c;
}
vec3 lightAt(vec3 alb, vec3 n, vec3 V, float gloss, float wrap) {
    float dm = dot(n, normalize(MOON_DIR));
    vec3 c = alb * (AMB * (0.7 + 0.3 * n.z) + MOONC * max((dm + wrap) / (1.0 + wrap), 0.0) * 0.85);
    vec3 H = normalize(normalize(MOON_DIR) + V);
    c += MOONC * pow(max(dot(n, H), 0.0), mix(14.0, 140.0, gloss)) * mix(0.04, 1.1, gloss);
    for (int i = 0; i < 6; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        float att = uLights[i].w / (1.0 + d * d * 0.09);
        c += uLightCol[i] * att * (alb * max((dot(n, l) + wrap) / (1.0 + wrap), 0.0) + pow(max(dot(reflect(-l, n), V), 0.0), mix(10.0, 90.0, gloss)) * gloss * 0.9);
    }
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 ndc = vUV;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 c = mix(vec3(0.03, 0.05, 0.1), vec3(0.008, 0.012, 0.035), smoothstep(-0.1, 0.6, d.z));
        float m = dot(d, normalize(vec3(-0.35, 0.9, 0.3)));
        c += MOONC * (smoothstep(0.9994, 0.9997, m) * 2.5 + pow(max(m, 0.0), 60.0) * 0.4);
        vec2 g = floor(gl_FragCoord.xy / 2.0);
        c += step(0.997, hash(g)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 30.0)) * smoothstep(0.0, 0.3, d.z) * 0.8;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.8, 1.0, lum(o))); return;
    }
    vec3 V = normalize(cPoint - vWorld);
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.5); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.25, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.85); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {
        vec3 p = vWorld * 2.2;
        float t = fbm(p * 1.3);
        float vein = pow(1.0 - abs(sin(p.x * 1.7 + p.y * 0.9 + p.z * 2.3 + t * 7.0)), 18.0);
        vec3 alb = mix(vCol, vCol * vec3(0.5, 0.55, 0.62), vein * 0.75) * (0.93 + t * 0.12);
        vec3 c = lightAt(alb, n, V, 0.75, 0.45);
        c += alb * vec3(0.06, 0.055, 0.05);                                         // a little light inside the stone
        c += room(reflect(-V, n)) * 0.12 * pow(1.0 - max(dot(n, V), 0.0), 2.0);
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 8.0) {
        vec3 R = reflect(-V, n);
        float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 c = lightAt(vCol, n, V, 1.0, 0.0) + room(R) * (0.25 + fres * 0.9);
        c += vec3(0.25, 0.12, 0.4) * pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.5;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.75, 1.0, lum(o)) * 0.5); return;
    }
    vec3 c = lightAt(vCol, n, V, mat == 1.0 ? 0.9 : 0.0, 0.2);
    if (mat == 1.0) c += room(reflect(-V, n)) * 0.15;
    gl_FragColor = vec4(tone(c), 0.0);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos");
    gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, { program, cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"), xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"), varsLocation: loc("veriables") });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
