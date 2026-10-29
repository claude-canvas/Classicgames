// Snake 3D shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis, zAxis,
// veriables), so the library's camera drives everything. col.a = material.
//
//   0 LIT      flat-shaded low-poly surfaces (stones, trees, terrain)
//   1 GLOSSY   snake skin, fruit, crystals: sun highlight, sky reflection, rim light
//   2 GLOW     emissive
//   3 SKY      full-screen sky: time-of-day gradient, sun, a few stars at dusk
//   4 WATER    the lake: animated ripples reflecting the sky, sun glitter
//   5 SPRITE   additive glow; pos.w = size + corner * 100, camera-facing
//   6 BOARD    the playfield: checkered grass with soft tile edges
//   7 CLOUD    soft cloud puffs; pos.w = size + corner * 100
//   8 SHADOW   soft dark blob lying flat; pos.w = size + corner * 100
// uShift moves the whole picture on screen (to keep the board clear of the HUD and the touch pad).
// Space's xUnitVec points to screen-left, so screen x uses -dot(v, xAxis).

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec2 uShift;

varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;

void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = vec3(0.0); return; }
    vec3 p = pos.xyz;
    if (mat == 5.0 || mat == 7.0 || mat == 8.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        if (mat == 8.0) p += vec3(c * size, 0.0);
        else p += (-xAxis * c.x + yAxis * c.y) * size;
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float NEAR = 0.1, FAR = 900.0;
    gl_Position = vec4(xp * k + uShift.x * zp, yp * k * aspect + uShift.y * zp, zp * (FAR + NEAR) / (FAR - NEAR) - 2.0 * FAR * NEAR / (FAR - NEAR), zp);
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
uniform vec2 uShift;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uTop;
uniform vec3 uHor;
uniform vec3 uSunDir;      // the sun you see in the sky
uniform vec3 uLight;       // key light, from in front so the board faces it
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uDusk;       // 0 day … 1 dusk: stars, warmer glow
uniform float uFog;
uniform float uFlash;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 sky(vec3 d) {
    vec3 c = mix(uHor, uTop, smoothstep(-0.02, 0.5, d.z));
    vec3 L = normalize(uSunDir);
    float s = max(dot(d, L), 0.0);
    c += uSunCol * (smoothstep(0.9996, 0.99985, s) * 3.0 + pow(s, 900.0) * 0.6 + pow(s, 50.0) * 0.4 + pow(s, 7.0) * 0.2);
    return c;
}
vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.5); }
vec3 fogged(vec3 c, float dist) { return mix(c, uHor, clamp(1.0 - exp(-dist * uFog), 0.0, 1.0)); }
vec3 finish(vec3 c) {
    c = tone(c);
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.2);
    return mix(clamp(c, 0.0, 1.0), vec3(1.0), uFlash);
}

void main() {
    float mat = floor(vMat + 0.5);
    vec3 V = normalize(cPoint - vWorld);
    float dist = length(cPoint - vWorld);
#ifdef GL_OES_standard_derivatives
    vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 fn = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(fn, V) < 0.0) fn = -fn;

    if (mat == 3.0) {
        vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0 - uShift;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 c = sky(d);
        vec2 g = floor(gl_FragCoord.xy / 2.0);
        c += step(0.998, hash(g)) * uDusk * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g) * 30.0)) * smoothstep(0.1, 0.4, d.z) * vec3(0.9, 0.95, 1.0);
        gl_FragColor = vec4(finish(c), 1.0); return;
    }
    if (mat == 5.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.05, 0.0);
        gl_FragColor = vec4(vCol * k, 1.0); return;
    }
    if (mat == 7.0) {
        float r2 = dot(vUV, vUV);
        float n = noise(vUV * 2.3 + vCol.xy * 10.0) * 0.6 + noise(vUV * 5.0 - vCol.yx * 7.0) * 0.4;
        float a = clamp((exp(-r2 * 2.0) - 0.14) * 1.35 * (0.55 + 0.7 * n), 0.0, 1.0) * vCol.z;
        vec3 sunSide = uSunCol * pow(max(dot(normalize(vWorld - cPoint), normalize(uSunDir)), 0.0), 4.0) * 0.6;
        vec3 cc = mix(uHor, vec3(1.0), 0.6 - uDusk * 0.3) * (0.82 + 0.3 * n - vUV.y * 0.14) + sunSide;
        cc = mix(cc, uHor, clamp(1.0 - exp(-dist * uFog * 0.5), 0.0, 1.0));
        gl_FragColor = vec4(finish(cc) * a, a); return;
    }
    if (mat == 8.0) {
        float a = smoothstep(1.0, 0.15, length(vUV)) * vCol.r;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
    }
    if (mat == 2.0) { gl_FragColor = vec4(finish(fogged(vCol, dist * 0.3)), 1.0); return; }

    vec3 L = normalize(uLight);
    vec3 skyLight = uAmb * (0.55 + 0.45 * fn.z);
    vec3 c;
    if (mat == 4.0) {                                                 // lake
        vec2 q = vWorld.xy;
        float t = uTime;
        float h0 = noise(q * 0.45 + vec2(t * 0.25, t * 0.1)) + noise(q * 1.1 - vec2(t * 0.18, -t * 0.3)) * 0.5;
        float hx = noise((q + vec2(0.08, 0.0)) * 0.45 + vec2(t * 0.25, t * 0.1)) + noise((q + vec2(0.08, 0.0)) * 1.1 - vec2(t * 0.18, -t * 0.3)) * 0.5;
        float hy = noise((q + vec2(0.0, 0.08)) * 0.45 + vec2(t * 0.25, t * 0.1)) + noise((q + vec2(0.0, 0.08)) * 1.1 - vec2(t * 0.18, -t * 0.3)) * 0.5;
        vec3 n = normalize(vec3((h0 - hx) * 1.6, (h0 - hy) * 1.6, 1.0));
        vec3 R = reflect(-V, n);
        R.z = abs(R.z);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 deep = vec3(0.02, 0.16, 0.22) * (skyLight + uSunCol * 0.4);
        c = mix(deep, sky(R), clamp(fres * 1.15 + 0.12, 0.0, 1.0));
        c += uSunCol * pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0) * 3.0;
        gl_FragColor = vec4(finish(fogged(c, dist * 0.6)), 1.0); return;
    }
    float diff = max(dot(fn, L), 0.0);
    if (mat == 1.0) {
        vec3 R = reflect(-V, fn);
        float fres = 0.05 + 0.95 * pow(1.0 - max(dot(fn, V), 0.0), 5.0);
        c = vCol * (skyLight + uSunCol * diff * 0.95);
        c = mix(c, sky(R), fres * 0.45);
        c += uSunCol * pow(max(dot(R, L), 0.0), 50.0) * 0.8;
        c += uHor * pow(1.0 - max(dot(fn, V), 0.0), 3.0) * 0.2;
    } else if (mat == 6.0) {                                          // checkered grass board, 1 unit per cell
        vec2 cell = floor(vWorld.xy);
        float chk = mod(cell.x + cell.y, 2.0);
        vec2 f = fract(vWorld.xy);
        float edge = smoothstep(0.0, 0.06, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
        float n = noise(vWorld.xy * 3.0) * 0.5 + noise(vWorld.xy * 9.0) * 0.5;
        vec3 g = mix(vec3(0.36, 0.7, 0.22), vec3(0.47, 0.8, 0.28), chk) * (0.86 + 0.24 * n) * (0.8 + 0.2 * edge);
        c = g * (skyLight + uSunCol * max(L.z, 0.2) * 0.95);
    } else {
        c = vCol * (skyLight + uSunCol * diff);
        c += vCol * uAmb * pow(1.0 - max(dot(fn, V), 0.0), 3.0) * 0.3;
    }
    c = fogged(c, dist);
    gl_FragColor = vec4(finish(c), 1.0);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos");
    gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, {
        program,
        cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"),
        xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"),
        varsLocation: loc("veriables"),
    });
    gl.useProgram(program);
    const U = {};
    for (const n of ["aspect", "veriables", "uShift", "uRes", "uTime", "uTop", "uHor", "uSunDir", "uLight", "uSunCol", "uAmb", "uDusk", "uFog", "uFlash"]) U[n] = loc(n);
    return U;
}
