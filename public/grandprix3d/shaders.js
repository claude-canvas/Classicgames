// Grand Prix 3D shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis, zAxis,
// veriables), so the library's camera drives everything. col.a = material.
//
//   0 LIT      flat-shaded scenery
//   1 PAINT    glossy car paint, helmet, glass: sun highlight, sky reflection
//   2 GLOW     emissive
//   3 SKY      full-screen sky: gradient, sun, stars at night
//   4 WATER    the lake: ripples reflecting the sky
//   5 SPRITE   additive glow; pos.w = size + corner * 100, camera-facing
//   6 ROAD     asphalt: col.r = lateral offset, col.g = distance along the track → lines, start line, grid boxes
//   7 CLOUD    soft cloud puffs; pos.w = size + corner * 100
//   8 SHADOW   soft dark blob; explicit quad, pos.w = 1 + corner * 100, col.r = strength
//   9 LAMP     floodlight heads: emissive, brighter at night
//  10 GRASS    the infield and surroundings: mowing stripes, colour noise
//  11 SKID     tyre marks; explicit quad, col.r = strength
//  12 CROWD    grandstand seats full of spectators (cells of random colours)
//  13 SMOKE    tyre smoke puff; camera-facing, col.r = alpha, col.g = brightness
//  14 GRAVEL   gravel traps
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

varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;

void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = vec3(0.0); return; }
    vec3 p = pos.xyz;
    if (mat == 5.0 || mat == 7.0 || mat == 13.0 || mat == 8.0 || mat == 11.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        if (mat != 8.0 && mat != 11.0) p += (-xAxis * c.x + yAxis * c.y) * size;
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float NEAR = 0.25, FAR = 3200.0;
    gl_Position = vec4(xp * k, yp * k * aspect, zp * (FAR + NEAR) / (FAR - NEAR) - 2.0 * FAR * NEAR / (FAR - NEAR), zp);
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
uniform vec3 uTop;
uniform vec3 uHor;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uNight;
uniform float uFog;
uniform float uFlash;
uniform float uLen;        // lap length: the start line sits at s = 0 = uLen

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 sky(vec3 d) {
    vec3 c = mix(uHor, uTop, smoothstep(-0.02, 0.45, d.z));
    vec3 L = normalize(uSunDir);
    float s = max(dot(d, L), 0.0);
    c += uSunCol * (smoothstep(0.9993, 0.9997, s) * 3.0 * (1.0 - uNight * 0.6) + pow(s, 700.0) * 0.8 + pow(s, 40.0) * 0.4 + pow(s, 6.0) * 0.2);
    return c;
}
vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.5); }
vec3 fogged(vec3 c, float dist) { return mix(c, uHor, clamp(1.0 - exp(-dist * uFog), 0.0, 1.0)); }
vec3 finish(vec3 c) {
    c = tone(c);
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.15);
    return mix(clamp(c, 0.0, 1.0), vec3(1.0), uFlash);
}

void main() {
    float mat = floor(vMat + 0.5);
    vec3 V = normalize(cPoint - vWorld);
    float dist = length(cPoint - vWorld);
#ifdef GL_OES_standard_derivatives
    vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float fw = length(fwidth(vWorld.xy));
#else
    vec3 fn = vec3(0.0, 0.0, 1.0);
    float fw = dist * 0.002;
#endif
    if (dot(fn, V) < 0.0) fn = -fn;

    if (mat == 3.0) {
        vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 c = sky(d);
        vec2 g = floor(gl_FragCoord.xy / 2.0);
        c += step(0.9975, hash(g)) * uNight * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g) * 30.0)) * smoothstep(0.05, 0.3, d.z) * vec3(0.9, 0.95, 1.0);
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
        vec3 sunSide = uSunCol * pow(max(dot(normalize(vWorld - cPoint), normalize(uSunDir)), 0.0), 3.0) * 0.9;
        vec3 cc = (mix(uHor, uTop * 0.6 + vec3(0.35), 0.4) * (0.8 + 0.3 * n - vUV.y * 0.14) + sunSide) * (1.0 - uNight * 0.72);
        gl_FragColor = vec4(finish(cc) * a, a); return;
    }
    if (mat == 13.0) {
        float r2 = dot(vUV, vUV);
        float n = noise(vUV * 2.0 + vCol.b * 13.0);
        float a = clamp((exp(-r2 * 2.2) - 0.12) * (0.6 + 0.6 * n), 0.0, 1.0) * vCol.r;
        vec3 cc = vec3(vCol.g) * (uAmb * 0.9 + uSunCol * 0.45) * (0.9 + 0.2 * n);
        gl_FragColor = vec4(finish(fogged(cc, dist)) * a, a); return;
    }
    if (mat == 8.0) {
        float a = smoothstep(1.0, 0.25, length(vUV)) * vCol.r;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
    }
    if (mat == 11.0) {
        float a = (1.0 - smoothstep(0.45, 1.0, abs(vUV.x))) * vCol.r * (0.8 + 0.2 * noise(vWorld.xy * 4.0));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.85); return;
    }
    if (mat == 2.0) { gl_FragColor = vec4(finish(vCol), 1.0); return; }
    if (mat == 9.0) { gl_FragColor = vec4(finish(vCol * (0.3 + uNight * 2.2)), 1.0); return; }

    vec3 L = normalize(uSunDir);
    vec3 skyLight = uAmb * (0.55 + 0.45 * fn.z);
    vec3 c;
    vec2 q = vWorld.xy;
    if (mat == 4.0) {                                                 // the lake
        float t = uTime;
        vec2 p = q * vec2(0.5, 0.5);
        float h0 = noise(p + vec2(t * 0.3, t * 0.1)) + noise(p * 2.3 - vec2(t * 0.2, -t * 0.35)) * 0.5;
        float hx = noise(p + vec2(0.06, 0.0) + vec2(t * 0.3, t * 0.1)) + noise((p + vec2(0.06, 0.0)) * 2.3 - vec2(t * 0.2, -t * 0.35)) * 0.5;
        float hy = noise(p + vec2(0.0, 0.06) + vec2(t * 0.3, t * 0.1)) + noise((p + vec2(0.0, 0.06)) * 2.3 - vec2(t * 0.2, -t * 0.35)) * 0.5;
        vec3 n = normalize(vec3((h0 - hx) * 0.8, (h0 - hy) * 0.8, 1.0));
        vec3 R = reflect(-V, n); R.z = abs(R.z);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 deep = vec3(0.03, 0.14, 0.18) * (uAmb + uSunCol * 0.3);
        c = mix(deep, sky(R), clamp(fres * 1.1 + 0.1, 0.0, 1.0));
        c += uSunCol * pow(max(dot(R, L), 0.0), 160.0) * 3.0;
        gl_FragColor = vec4(finish(fogged(c, dist)), 1.0); return;
    }
    float diff = max(dot(fn, L), 0.0);
    if (mat == 1.0) {
        vec3 R = reflect(-V, fn);
        float fres = 0.06 + 0.94 * pow(1.0 - max(dot(fn, V), 0.0), 5.0);
        c = vCol * (skyLight + uSunCol * diff * 0.95);
        c = mix(c, sky(R) * (0.7 + 0.3 * step(0.0, R.z)), fres * 0.55 + 0.06);
        c += uSunCol * pow(max(dot(R, L), 0.0), 80.0) * 1.3;
    } else if (mat == 6.0) {                                          // asphalt and markings
        float u = vCol.r, s = vCol.g;
        float grain = noise(q * 3.0) * 0.5 + noise(q * 17.0) * 0.5;
        vec3 asph = vec3(0.13, 0.13, 0.145) * (0.86 + 0.28 * grain);
        asph *= 1.0 - 0.18 * exp(-pow((abs(u) - 2.2) / 1.4, 2.0)) * (0.6 + 0.4 * noise(q * 0.4));   // rubbered-in line
        float aa = max(fw, 0.02);
        float edge = 1.0 - smoothstep(0.14 - aa, 0.14 + aa, abs(abs(u) - 6.65));
        float sw = min(s, uLen - s);                                   // distance to the start line
        float startLine = (1.0 - smoothstep(0.9 - aa, 0.9 + aa, sw)) * step(abs(u), 6.5);
        float checker = mod(floor(u / 0.9) + floor(s / 0.9), 2.0);
        // grid boxes behind the line, staggered left and right
        float gs = uLen - s, slot = floor((gs - 6.0) / 8.0 + 0.5), g0 = 6.0 + slot * 8.0;
        float side = mod(slot, 2.0) < 0.5 ? 2.8 : -2.8;
        float box = step(0.0, slot) * step(slot, 7.0) * step(abs(gs - g0), 0.12 + aa) * step(abs(u - side), 1.3);
        box += step(0.0, slot) * step(slot, 7.0) * step(abs(abs(u - side) - 1.3), 0.1 + aa) * step(gs - g0, 0.0) * step(g0 - gs, 1.4);
        vec3 paint = vec3(0.95, 0.95, 0.92);
        c = mix(asph, paint, clamp(edge + box, 0.0, 1.0));
        c = mix(c, vec3(checker * 0.95), startLine);
        c *= skyLight + uSunCol * max(L.z, 0.2) * 0.95;
        vec3 R = reflect(-V, vec3(0.0, 0.0, 1.0));
        c += uSunCol * pow(max(dot(R, L), 0.0), 16.0) * 0.28 * (1.0 - uNight);
        // floodlit at night: pools of light every 40 m along the track, from the left side
        float lamp = exp(-pow((fract(s / 40.0) - 0.5) * 3.2, 2.0));
        c *= 1.0 - uNight * 0.35;
        c += vec3(1.0, 0.92, 0.8) * uNight * 0.2 * (0.15 + lamp * 1.1) * (0.55 + 0.45 * smoothstep(-8.0, 8.0, u)) * (0.8 + 0.4 * grain);
    } else if (mat == 10.0) {                                         // grass
        float n = noise(q * 0.05) * 0.6 + noise(q * 0.31) * 0.4;
        float fine = noise(q * 2.7);
        float stripe = mix(0.0, step(0.5, fract(q.x / 14.0 + q.y / 50.0)) - 0.5, 1.0 - smoothstep(60.0, 260.0, dist));
        vec3 g = mix(vec3(0.17, 0.42, 0.13), vec3(0.3, 0.55, 0.16), n) * (1.0 + stripe * 0.16) * (0.92 + fine * 0.16 * (1.0 - smoothstep(20.0, 80.0, dist)));
        c = g * (skyLight + uSunCol * diff * 0.9);
        c += vec3(0.6, 0.9, 0.5) * uNight * 0.05;
    } else if (mat == 14.0) {                                         // gravel
        float n = noise(q * 9.0) * 0.5 + noise(q * 2.0) * 0.5;
        c = vec3(0.62, 0.55, 0.42) * (0.8 + 0.35 * n) * (skyLight + uSunCol * diff);
    } else if (mat == 12.0) {                                         // crowd
        vec2 cell = floor(vec2(vWorld.x + vWorld.y, vWorld.z) * vec2(1.6, 2.2));
        float h = hash(cell), h2 = hash(cell + 7.1);
        vec3 shirt = h < 0.2 ? vec3(0.9, 0.12, 0.1) : h < 0.35 ? vec3(0.95, 0.85, 0.2) : h < 0.5 ? vec3(0.15, 0.3, 0.85) : h < 0.65 ? vec3(0.92) : h < 0.8 ? vec3(0.1, 0.55, 0.3) : vec3(0.95, 0.5, 0.15);
        float bob = sin(uTime * 7.0 + h2 * 40.0) * 0.5 + 0.5;
        float person = step(0.25, fract(vWorld.z * 2.2 + bob * 0.08 * step(0.7, h2))) * step(0.15, h2);
        c = mix(vCol, shirt, person * (1.0 - smoothstep(60.0, 200.0, dist) * 0.6)) * (skyLight + uSunCol * diff * 0.8);
        c += shirt * uNight * 0.12 * person;
    } else {
        c = vCol * (skyLight + uSunCol * diff);
        c += vCol * uAmb * pow(1.0 - max(dot(fn, V), 0.0), 3.0) * 0.25;
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
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uTop", "uHor", "uSunDir", "uSunCol", "uAmb", "uNight", "uFog", "uFlash", "uLen"]) U[n] = loc(n);
    return U;
}
