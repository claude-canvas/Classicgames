// Storm Beacon scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// World: metres, z up, the sea is +y. The lighthouse lens is the main light: a spotlight (uBeamPos/Dir/Cos) that
// every lit material receives, plus up to 8 point lights (town windows, buoys, flares) and the lightning (uFlash).
//
//   0 MATTE   wood, hulls, walls       1 GLOSS  wet paint, metal (spec)     2 ROCK  wet rock: dark + spec sheen
//   3 BG      storm sky: churning cloud deck lit from below by flashes and the beam
//   4 SPRITE  additive glow · 5 EMIT emissive · 6 SHADOW (unused) · 7 ADD additive (beam cone, rain, bolts)
//   8 SEA     Gerstner-displaced in the vertex shader; Fresnel sky, foam on crests + around reefs, beam glitter
//   9 GLASS   lantern-room glass (pos.w = glow) · 10 GRASS  cliff-top turf · 11 FOAM  surf around rocks
import { GLSL_WAVES } from "./waves.js";

export const NEAR = 0.2, FAR = 6000.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform float uStorm;
varying vec3 vCol;
varying float vMat;
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
varying vec3 vN;
${GLSL_WAVES}
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vW = pos.w; vN = vec3(0.0, 0.0, 1.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 8.0) {
        float crest; vec3 n;
        p = gerstner(p.xy, uTime, uStorm, n, crest);
        vN = n; vUV = vec2(crest, 0.0);
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
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
varying vec3 vN;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform float uStorm;
uniform float uFlash;
uniform vec3 uBeamPos;
uniform vec3 uBeamDir;
uniform float uBeamCos;
uniform float uBeamReach;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;
uniform vec4 uReefs[12];

const vec3 AMB = vec3(0.07, 0.085, 0.11);
const vec3 FLASHC = vec3(0.75, 0.82, 1.0);
const vec3 BEAMC = vec3(1.0, 0.92, 0.72);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.4); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.1), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }

// spotlight from the lens: soft-edged cone, falls off with distance, dimmed by rain
float beam(vec3 p) {
    vec3 L = p - uBeamPos; float d = length(L);
    float c = dot(L / d, uBeamDir);
    float cone = smoothstep(uBeamCos - 0.0025, uBeamCos + 0.0015, c);
    return cone * 1800.0 / (d * d * 0.01 + 300.0) * (1.0 - smoothstep(uBeamReach * 0.85, uBeamReach * 1.1, d));
}
vec3 skyCol(vec3 d) {
    float h = max(d.z, 0.0);
    vec3 c = mix(vec3(0.07, 0.085, 0.11), vec3(0.015, 0.02, 0.03), smoothstep(0.0, 0.5, h));
    vec2 q = d.xy / (d.z + 0.12) * 1.3 + vec2(uTime * 0.035, uTime * 0.012);
    float cl = fbm(q) * 0.7 + fbm(q * 2.4 - uTime * 0.02) * 0.3;
    c *= 0.6 + cl * 0.9;
    c += FLASHC * uFlash * (0.25 + cl * 0.9) * smoothstep(-0.05, 0.3, d.z);
    // the beam lights the cloud base where it points
    float bd = max(dot(d, normalize(uBeamDir + vec3(0.0, 0.0, 0.35))), 0.0);
    c += BEAMC * pow(bd, 30.0) * 0.05 * cl;
    return c;
}
vec3 skyLite(vec3 d) { float h = max(d.z, 0.0); return mix(vec3(0.07, 0.085, 0.11), vec3(0.015, 0.02, 0.03), smoothstep(0.0, 0.5, h)) * 0.95 + FLASHC * uFlash * 0.5; }
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.05) * (0.3 + 0.7 * max(dot(n, l), 0.0));
    }
    return acc;
}
vec3 shade(vec3 alb, vec3 n) {
    vec3 Lb = normalize(uBeamPos - vWorld);
    float b = beam(vWorld) * (0.25 + 0.75 * max(dot(n, Lb), 0.0));
    return alb * (AMB * (0.6 + 0.4 * n.z) + BEAMC * b + lights(n) + FLASHC * uFlash * (0.6 + 0.4 * max(n.z, 0.0)));
}
vec3 fogc(vec3 c, float dist) {
    vec3 d = normalize(vWorld - cPoint);
    float f = 1.0 - exp(-dist * (0.0011 + 0.0012 * uStorm));
    return mix(c, skyLite(vec3(d.xy, 0.02)) * 1.2, f);
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyCol(d));
        gl_FragColor = vec4(o, uFlash * 0.4); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.8); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
    if (mat == 8.0) {                                                    // the sea
        vec3 n = normalize(vN + vec3((vnoise(vWorld.xy * 0.6 + uTime * 0.6) - 0.5) * 0.12, (vnoise(vWorld.xy * 0.6 - uTime * 0.5 + 7.0) - 0.5) * 0.12, 0.0));
        vec3 R = reflect(-V, n); R.z = abs(R.z);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 deep = vec3(0.004, 0.018, 0.024);
        float bm = beam(vWorld);
        // light scattered inside the water where the beam strikes (green-teal), and glitter off the facets
        vec3 sub = vec3(0.05, 0.28, 0.25) * bm * 0.22 * (0.6 + 0.4 * vUV.x * 8.0);
        vec3 Lb = normalize(uBeamPos - vWorld);
        float glit = pow(max(dot(reflect(-Lb, n), V), 0.0), 60.0) * bm * 2.5;
        vec3 c = deep + sub + skyCol(R) * fres * 1.4 + BEAMC * glit + lights(n) * 0.08 + FLASHC * uFlash * (0.12 + fres * 0.6);
        for (int i = 0; i < 8; i++) {                                     // town / buoy light streaks on the water
            if (float(i) >= uLightCount) break;
            vec3 Ll = normalize(uLights[i].xyz - vWorld);
            c += uLightCol[i] * pow(max(dot(reflect(-Ll, n), V), 0.0), 90.0) * uLights[i].w * 0.12 / (1.0 + length(uLights[i].xyz - vWorld) * 0.012);
        }
        // foam: wave crests + rings of surf around the reefs
        float crest = smoothstep(0.35, 0.75, vUV.x * 2.2 * uStorm + fbm(vWorld.xy * 0.08 + uTime * 0.1) * 0.5 - 0.15);
        float surf = 0.0;
        for (int i = 0; i < 12; i++) {
            vec4 r = uReefs[i]; if (r.z <= 0.0) continue;
            float dr = length(vWorld.xy - r.xy) - r.z;
            surf += smoothstep(26.0, 0.0, dr) * (0.55 + 0.45 * sin(dr * 0.5 - uTime * 2.2 + r.x)) * smoothstep(-6.0, 2.0, dr);
        }
        float foam = clamp(crest * 0.7 + surf * (0.5 + 0.5 * fbm(vWorld.xy * 0.25 + uTime * 0.3)), 0.0, 1.0) * smoothstep(0.35, 0.65, fbm(vWorld.xy * 0.18 + vec2(uTime * 0.08, 0.0)) + 0.3);
        vec3 foamC = vec3(0.5, 0.56, 0.6) * (AMB * 3.0 + BEAMC * bm * 0.55 + FLASHC * uFlash * 0.8 + lights(n) * 0.3);
        c = mix(c, foamC, foam * 0.85);
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.6, 1.0, lum(o)) * 0.5); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 9.0) {                                                    // lantern glass
        vec3 R = reflect(-V, n);
        vec3 c = skyLite(R) * 0.6 + vCol * vW * (0.8 + 0.2 * sin(uTime * 30.0));
        gl_FragColor = vec4(tone(c), clamp(vW, 0.0, 1.0)); return;
    }
    if (mat == 2.0) {                                                    // wet rock
        vec3 alb = vCol * (0.75 + 0.5 * vnoise(vWorld.xy * 0.5 + vWorld.z * 0.7)) * (0.85 + 0.3 * vnoise(vWorld.xy * 3.0 + vWorld.z));
        vec3 c = shade(alb, n);
        vec3 Lb = normalize(uBeamPos - vWorld);
        c += BEAMC * beam(vWorld) * pow(max(dot(reflect(-Lb, n), V), 0.0), 20.0) * 0.4 + FLASHC * uFlash * pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), V), 0.0), 8.0) * 0.4;
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.0); return;
    }
    if (mat == 10.0) {
        vec3 alb = vCol * (0.75 + 0.45 * vnoise(vWorld.xy * 1.3));
        gl_FragColor = vec4(tone(fogc(shade(alb, n), dist)), 0.0); return;
    }
    vec3 c = shade(vCol, n);
    if (mat == 1.0) { vec3 R = reflect(-V, n); vec3 Lb = normalize(uBeamPos - vWorld); c += skyLite(R) * 0.3 + BEAMC * beam(vWorld) * pow(max(dot(R, Lb), 0.0), 30.0) * 0.6 + lights(n) * 0.2; }
    vec3 o = tone(fogc(c, dist));
    gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.3);
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
    for (const n of ["aspect", "veriables", "uTime", "uStorm", "uFlash", "uBeamPos", "uBeamDir", "uBeamCos", "uBeamReach", "uLights", "uLightCol", "uLightCount", "uReefs"]) U[n] = loc(n);
    return U;
}
