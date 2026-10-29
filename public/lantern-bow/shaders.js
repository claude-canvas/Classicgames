// Lantern Bow scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables). col.a = material, pos.w = per-material data. World: metres, z up.
//
//   0 MATTE    wood, stone, ground, lawn (pos.w = detail-noise amount)
//   1 GLOSS    lacquer, bronze, roof tiles (pos.w = metalness 0..1)
//   2 FOLIAGE  cherry blossom / leaves: wrapped diffuse + backlit translucency (glows against the low sun)
//   3 BG       sky: time-of-day gradient, sun, cloud bands; stars, Milky Way and moon at night
//   4 SPRITE   additive glow (pos.w = size + corner·100) · 5 EMIT emissive · 6 SHADOW multiply contact shadow
//   7 ADD      additive (trails, streaks)
//   8 WATER    pond: sky reflection with wind ripples + Fresnel
//   9 PAPER    paper lit from inside: lanterns (pos.w = inner glow) and target faces
//  10 FAR      distant mountains: atmospheric perspective to the horizon colour, snow on the peaks

export const NEAR = 0.05, FAR = 6000.0;

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
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vW = pos.w;
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 6.0) { float u = step(1.5, pos.w); vUV = vec2(u, pos.w - 2.0 * u); }
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
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uSkyGlow;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform float uNight;
uniform vec3 uMoonDir;
uniform vec2 uWind;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.18), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }

vec3 skyGrad(vec3 d) {
    float h = d.z;
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.02, 0.55, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSkyGlow * (pow(s, 4.0) * 0.6 + pow(s, 32.0) * 0.8) * (1.0 - uNight * 0.7);
    c = mix(c, uSkyHor * 0.55, smoothstep(0.0, -0.25, h));
    return c;
}
vec3 skyFull(vec3 d) {
    vec3 c = skyGrad(d);
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * smoothstep(0.9993, 0.9997, s) * 6.0 * (1.0 - uNight);
    // cloud bands, lit from below by the low sun
    if (d.z > 0.0) {
        vec2 q = d.xy / (d.z + 0.08) * 0.9 + vec2(uTime * 0.004, 0.0);
        float n = fbm(q * vec2(0.6, 2.2));
        float cl = smoothstep(0.52, 0.8, n) * smoothstep(0.0, 0.08, d.z) * smoothstep(0.7, 0.15, d.z);
        vec3 lit = mix(uSkyHor * 1.1, uSunCol * 1.4, pow(s, 3.0)) * (1.0 - uNight * 0.85) + vec3(0.05, 0.06, 0.1) * uNight;
        c = mix(c, lit + uSkyGlow * pow(s, 8.0) * 0.6, cl * 0.75);
    }
    if (uNight > 0.01) {
        vec2 sp = vec2(atan(d.y, d.x) * 260.0, d.z * 260.0), g = floor(sp), f = fract(sp) - 0.5;
        vec2 jit = vec2(hash12(g + 7.0), hash12(g + 13.0)) - 0.5;
        float st = step(0.993, hash12(g)) * smoothstep(0.22, 0.0, length(f - jit * 0.5)) * (0.55 + 0.45 * sin(uTime * 2.0 + hash12(g + 3.0) * 40.0)) * smoothstep(0.02, 0.3, d.z);
        float mw = smoothstep(0.25, 0.0, abs(dot(d, normalize(vec3(0.5, 0.2, 0.84))))) * fbm(d.xy * 6.0);
        float m = dot(d, uMoonDir);
        c += (vec3(st) * 0.9 + vec3(0.45, 0.5, 0.7) * mw * 0.18) * uNight;
        c += vec3(0.95, 0.93, 0.85) * (smoothstep(0.99965, 0.9998, m) * 2.4 + pow(max(m, 0.0), 80.0) * 0.18) * uNight;
    }
    return c;
}
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.6) * (0.3 + 0.7 * max(dot(n, l), 0.0));
    }
    return acc;
}
vec3 shade(vec3 alb, vec3 n, float wrap) {
    float dl = max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0);
    vec3 amb = mix(uAmbBot, uAmbTop, n.z * 0.5 + 0.5);
    return alb * (amb + uSunCol * dl * 1.25 * (1.0 - uNight * 0.9) + lights(n));
}
vec3 fog(vec3 c, float dist) {
    vec3 d = normalize(vWorld - cPoint);
    return mix(c, skyGrad(vec3(d.xy, max(d.z, 0.0) * 0.4)), smoothstep(40.0, 1400.0, dist) * 0.9);
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 ndc = vUV;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyFull(d));
        gl_FragColor = vec4(o, smoothstep(0.9, 1.0, lum(o)) * 0.8); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.15, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 8.0) {                                            // pond
        vec2 q = vWorld.xy * 1.6 + uWind * uTime * 0.5;
        float e = 0.08, h0 = vnoise(q) + 0.5 * vnoise(q * 2.7 + uTime * 0.3);
        float hx = vnoise(q + vec2(e, 0.0)) + 0.5 * vnoise((q + vec2(e, 0.0)) * 2.7 + uTime * 0.3);
        float hy = vnoise(q + vec2(0.0, e)) + 0.5 * vnoise((q + vec2(0.0, e)) * 2.7 + uTime * 0.3);
        vec3 wn = normalize(vec3(-(hx - h0) / e * 0.05, -(hy - h0) / e * 0.05, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        vec3 c = mix(vCol * (uAmbTop * 0.5 + lights(wn) * 0.3), skyGrad(R) * 0.95, 0.35 + fres * 0.6);
        c += uSunCol * pow(max(dot(R, uSunDir), 0.0), 300.0) * 3.0 * (1.0 - uNight);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.6); return;
    }
    if (mat == 9.0) {                                            // paper lit from inside
        float glow = vW;
        vec3 base = shade(vCol, n, 0.6);
        vec3 inner = vCol * glow * (1.0 + 0.15 * sin(uTime * 13.0 + vWorld.z * 4.0));
        float fib = 0.92 + 0.08 * vnoise(vWorld.xy * 40.0 + vWorld.z * 30.0);
        vec3 o = tone(fog((base + inner) * fib, dist));
        gl_FragColor = vec4(o, smoothstep(0.55, 1.0, lum(o)) * min(1.0, glow)); return;
    }
    if (mat == 10.0) {                                           // distant ridges
        float h = vWorld.z;
        vec3 alb = vCol * (0.8 + 0.25 * vnoise(vWorld.xy * 0.01));
        float snow = smoothstep(vW - 60.0, vW, h + vnoise(vWorld.xy * 0.02) * 40.0);
        alb = mix(alb, vec3(0.9, 0.92, 0.98), snow * step(1.0, vW));
        vec3 c = shade(alb, n, 0.4);
        vec3 d = normalize(vWorld - cPoint);
        float haze = 1.0 - exp(-dist / 900.0);
        c = mix(c, skyGrad(vec3(d.xy, 0.02)), clamp(haze * 0.92, 0.0, 0.95));
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 2.0) {                                            // blossom
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        float var = vnoise(vWorld.xy * 3.0 + vWorld.z * 2.0);
        vec3 alb = vCol * (0.8 + 0.35 * var);
        vec3 c = shade(alb, n, 0.9) + alb * uSunCol * back * 0.8 * (1.0 - uNight) + alb * lights(n) * 0.3;
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, back * 0.35 * (1.0 - uNight)); return;
    }
    if (mat == 1.0) {                                            // lacquer / bronze / tiles
        vec3 R = reflect(-V, n);
        float metal = vW;
        vec3 c = shade(vCol * (1.0 - metal * 0.6), n, 0.1);
        vec3 env = skyGrad(R);
        c += mix(env * 0.12, env * vCol * 0.9, metal);
        c += uSunCol * pow(max(dot(R, uSunDir), 0.0), mix(40.0, 120.0, metal)) * mix(0.5, 1.6, metal) * (1.0 - uNight);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.5); return;
    }
    vec3 alb = vCol;
    if (vW > 0.0) alb *= 1.0 - vW * 0.35 + vW * 0.5 * vnoise(vWorld.xy * 6.0 + vWorld.z * 3.0);
    vec3 o = tone(fog(shade(alb, n, 0.25), dist));
    gl_FragColor = vec4(o, 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uSunDir", "uSunCol", "uSkyTop", "uSkyHor", "uSkyGlow", "uAmbTop", "uAmbBot", "uNight", "uMoonDir", "uWind", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
