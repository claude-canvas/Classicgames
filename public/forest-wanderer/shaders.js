// Echoes of the Hollow scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// Lighting comes from environment uniforms (sun/moon direction and colour, ambient, sky colours, fog, moon, stars,
// eclipse) so each chapter has its own time of day and the ending can fade the eclipse into dawn.
// Alpha carries the depth-of-field circle of confusion (sky = 1.0), as in Paper Brook (see post.js).
//   0 MATTE  1 SOFT (characters)  2 LEAF  3 BG  4 SPRITE  5 EMIT  6 SHADOW (multiply pass)  7 ADD  8 WATER
//   9 GROUND (vCol = dirt, sand, variation)  10 ROCK (pos.w = water z)  11 FOLIAGE  12 GRASS  13 BARK  14 WOOD
//  15 DARK (shadow creatures)  16 METAL  17 PLASTER
export const NEAR = 0.05, FAR = 900.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
attribute vec3 nrm;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec4 uBone[69];
varying vec3 vCol;
varying float vMat;
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
varying vec3 vN;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vW = pos.w; vN = nrm;
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (pos.w > 999.5) {                     // GPU-skinned character vertex: pos.w = 1000 + bone
        int b = int(pos.w - 999.5) * 3; vec4 q = vec4(p, 1.0);
        p = vec3(dot(uBone[b], q), dot(uBone[b + 1], q), dot(uBone[b + 2], q)); vW = 0.0;
        vN = vec3(dot(uBone[b].xyz, nrm), dot(uBone[b + 1].xyz, nrm), dot(uBone[b + 2].xyz, nrm));
    } else if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 12.0) {
        float w = pos.w * pos.w, ph = p.x * 0.9 + p.y * 0.7;
        p.xy += vec2(0.8, 0.4) * (sin(uTime * 1.4 + ph) + 0.4 * sin(uTime * 3.3 + ph * 2.1)) * w * 0.035;
    } else if (mat == 11.0) {
        float sw = pos.w;
        p.x += sin(uTime * 0.9 + p.y * 0.2 + p.z * 0.3) * sw * 0.35;
        p.y += cos(uTime * 0.75 + p.x * 0.2) * sw * 0.22;
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float N = ${NEAR.toFixed(3)}, F = ${FAR.toFixed(1)};
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
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmbT;
uniform vec3 uAmbB;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uGlow;
uniform vec4 uMisc;          // x fog density, y moon, z stars, w eclipse
uniform float uBolt;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;
uniform sampler2D uShade;
uniform vec4 uShadeRect;
uniform vec3 uDof;
uniform float uHit;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.2), 0.0, 1.0); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 skyLite(vec3 d) {
    float h = d.z, s = max(dot(d, uSun), 0.0);
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.02, 0.55, h));
    c += uGlow * (pow(s, 5.0) * 0.5 + pow(s, 30.0) * 0.6) * (1.0 - uMisc.w * 0.5) * (1.0 - uMisc.y * 0.6);
    return mix(c, uAmbB * 1.5, smoothstep(0.0, -0.25, h));
}
vec3 sky(vec3 d) {
    vec3 c = skyLite(d); float s = max(dot(d, uSun), 0.0);
    if (uMisc.y > 0.5) {                                                       // moon
        float m = smoothstep(0.9993, 0.9996, s);
        vec2 q = vec2(dot(d, normalize(cross(uSun, vec3(0.0, 0.0, 1.0)))), d.z - uSun.z) * 900.0;
        c = mix(c, vec3(1.6, 1.62, 1.7) * (0.82 + 0.18 * vnoise(q * 0.25)), m) + vec3(0.25, 0.3, 0.45) * pow(s, 200.0);
    } else if (uMisc.w > 0.5) {                                                // eclipse: black disc and a burning corona
        float disc = smoothstep(0.99935, 0.9996, s);
        float ring = smoothstep(0.9988, 0.99935, s) * (1.0 - disc);
        c = mix(c, vec3(0.0), disc) + vec3(3.0, 1.2, 1.6) * ring * (0.8 + 0.2 * sin(uTime * 3.0)) + vec3(0.6, 0.15, 0.25) * pow(s, 60.0);
    } else c += vec3(4.0, 3.4, 2.6) * smoothstep(0.9985, 0.9992, s) + uGlow * pow(s, 400.0);
    if (uMisc.z > 0.0 && d.z > 0.0) {                                          // stars
        vec2 g = d.xy / (d.z + 0.35) * 220.0, gi = floor(g);
        float st = step(0.985, hash12(gi)) * smoothstep(0.45, 0.0, length(fract(g) - 0.5)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash12(gi + 3.0) * 30.0));
        c += vec3(1.0, 0.95, 0.9) * st * uMisc.z * smoothstep(0.02, 0.25, d.z) * 1.6;
    }
    if (d.z > 0.0) { vec2 q = d.xy / (d.z + 0.12) * 0.7 + vec2(uTime * 0.003, 0.0); float n = fbm(q * vec2(0.7, 1.5)); float cl = smoothstep(0.5, 0.8, n) * smoothstep(0.02, 0.12, d.z) * smoothstep(0.75, 0.2, d.z); c = mix(c, mix(uSkyHor * 0.9 + uAmbT * 0.4, uGlow * 1.3 + vec3(0.2), pow(s, 3.0) + 0.15), cl * 0.55); }
    return c + vec3(0.7, 0.6, 1.0) * uBolt * 0.6;
}
float sunVis(vec3 w) { vec2 uv = (w.xy - uShadeRect.xy) * uShadeRect.zw; return texture2D(uShade, uv).r * (0.9 + 0.1 * sin(uTime * 1.3 + w.x * 1.7 + w.y * 1.3)); }
vec3 lights(vec3 n) { vec3 acc = vec3(0.0); for (int i = 0; i < 8; i++) { if (float(i) >= uLightCount) break; vec3 L = uLights[i].xyz - vWorld; float d = length(L); acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.35) * (0.35 + 0.65 * max(dot(n, L / d), 0.0)); } return acc; }
vec3 shade(vec3 alb, vec3 n, float wrap, float vis) { float dl = max((dot(n, uSun) + wrap) / (1.0 + wrap), 0.0); dl = mix(dl, smoothstep(0.18, 0.42, dl) * 0.85 + dl * 0.15, 0.4); return alb * (mix(uAmbB, uAmbT, n.z * 0.5 + 0.5) * (1.0 + uBolt * 2.0) + uSunCol * dl * vis + lights(n)); }
vec3 fogc(vec3 c, float dist) {
    vec3 d = normalize(vWorld - cPoint);
    vec3 hz = skyLite(vec3(d.xy, max(d.z, 0.0) * 0.35 + 0.02));
    return mix(c, hz, clamp(1.0 - exp(-dist * uMisc.x), 0.0, 0.92));
}
// miniature (tilt-shift) look: a sharp band around the focus distance, soft near and far
float coc(float dist) { float nearB = smoothstep(uDof.x * 0.55, uDof.x * 0.28, dist) * uDof.z; float farB = smoothstep(uDof.x * 2.5, uDof.x * 12.0, dist) * uDof.y; return min(0.96, max(nearB, farB)); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect))); gl_FragColor = vec4(tone(sky(d)), 1.0); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); gl_FragColor = vec4(vCol * k, 0.0); return; }
    if (mat == 7.0) { gl_FragColor = vec4(vCol, 0.0); return; }
    if (mat == 6.0) { float k = 1.0 - (1.0 - smoothstep(0.0, 1.0, length(vCol.rg))) * vCol.b; gl_FragColor = vec4(vec3(k), 1.0); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(vN, vN) > 0.01 && mat != 8.0) n = normalize(vN);
    if (dot(n, V) < 0.0) n = -n;
    float vis = sunVis(vWorld);
    vec3 c;
    if (mat == 5.0) c = vCol;
    else if (mat == 8.0) {                                                    // water
        vec2 p = vWorld.xy * 0.35 + vec2(uTime * 0.12, uTime * 0.05);
        float e = 0.05, h0 = fbm(p), hx = fbm(p + vec2(e, 0.0)), hy = fbm(p + vec2(0.0, e));
        vec3 wn = normalize(vec3(-(hx - h0) / e * 0.18, -(hy - h0) / e * 0.18, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        float depth = clamp(vW / 2.0, 0.0, 1.0);
        vec3 body = mix(vec3(0.12, 0.2, 0.16), vec3(0.02, 0.05, 0.07), depth) * (uAmbT * 1.6 + uSunCol * 0.2 * vis);
        c = mix(body, sky(R) * 0.85 + lights(vec3(0.0, 0.0, 1.0)) * 0.15, fres * 0.85);
        float sp = max(dot(R, uSun), 0.0);
        c += uSunCol * (pow(sp, 300.0) * 6.0 + pow(sp, 40.0) * 0.3) * (0.3 + vis) * (1.0 + uMisc.y * 2.0);
        float foam = smoothstep(0.25, 0.0, vW) * smoothstep(0.55, 0.7, vnoise(vWorld.xy * 2.0 + uTime * 0.3));
        c = mix(c, (uAmbT + uSunCol * 0.4) * 0.9, foam * 0.5);
    } else {
        float back = pow(max(dot(-V, uSun), 0.0), 3.0);
        vec3 alb = vCol, nn = n, add = vec3(0.0);
        float wrap = 0.25, lv = vis;
        vec3 R = reflect(-V, n);
        float spec = pow(max(dot(R, uSun), 0.0), 40.0);
        if (mat == 9.0) {                                                     // ground
            vec2 w = vWorld.xy; float slope = 1.0 - n.z;
            vec3 grass = mix(vec3(0.17, 0.28, 0.06), vec3(0.32, 0.4, 0.1), vnoise(w * 0.25)) * (0.78 + 0.4 * vnoise(w * 2.7));
            grass = mix(grass, vec3(0.42, 0.4, 0.16), smoothstep(0.6, 0.85, vCol.b) * 0.5);
            vec3 dirt = mix(vec3(0.42, 0.33, 0.22), vec3(0.55, 0.45, 0.32), vnoise(w * 1.3)) * (0.8 + 0.3 * vnoise(w * 7.0));
            dirt = mix(dirt, vec3(0.45, 0.42, 0.38), step(0.82, vnoise(w * 3.0)) * 0.6);
            vec3 sand = vec3(0.6, 0.53, 0.4) * (0.85 + 0.2 * vnoise(w * 4.0));
            vec3 rock = vec3(0.4, 0.38, 0.36) * (0.75 + 0.4 * vnoise(w * 1.5 + vWorld.z));
            alb = mix(grass, dirt, smoothstep(0.25, 0.7, vCol.r));
            alb = mix(alb, sand, vCol.g);
            alb = mix(alb, rock, smoothstep(0.38, 0.6, slope));
            wrap = 0.3; add = alb * uSunCol * vis * back * 0.25;
        } else if (mat == 12.0) {
            nn = normalize(n + vec3(0.0, 0.0, 0.8));
            alb = vCol * (0.85 + 0.3 * hash12(floor(vWorld.xy * 40.0)));
            wrap = 0.6; add = alb * uSunCol * vis * (back * 1.4 + 0.1) * (0.3 + vW) + alb * uAmbT * 0.25 * vW;
        } else if (mat == 11.0) {
            float edge = 1.0 - abs(dot(n, V));
            float holes = vnoise(vWorld.xy * 6.0 + vWorld.z * 4.0) * 0.6 + vnoise(vWorld.yz * 13.0 + vWorld.x * 5.0) * 0.4;
            if (holes < 0.18 + edge * 0.55 && dist > 2.0) discard;
            lv = max(vis, 0.3) * (0.55 + 0.45 * vnoise(vWorld.xy * 0.7 + vWorld.z));
            alb = vCol * (0.7 + 0.45 * vnoise(vWorld.xy * 5.0 + vWorld.z * 4.0));
            wrap = 0.6; add = alb * uSunCol * (back * 1.6 * (0.4 + edge) + 0.05) * lv;
        } else if (mat == 10.0) {
            float z = vWorld.z;
            alb = vCol * (0.7 + 0.45 * fbm(vWorld.xy * 2.0 + z * 2.0));
            alb *= 1.0 - 0.2 * smoothstep(0.025, 0.0, abs(vnoise(vWorld.xy * 6.0 + z * 5.0) - 0.5));
            alb = mix(alb, vec3(0.74, 0.74, 0.58), smoothstep(0.74, 0.8, vnoise(vWorld.xy * 12.0 + z * 10.0)) * 0.4);
            alb = mix(alb, vec3(0.2, 0.3, 0.08) * (0.8 + 0.4 * vnoise(vWorld.xy * 6.0)), smoothstep(0.55, 0.85, n.z) * smoothstep(0.4, 0.65, vnoise(vWorld.xy * 2.5 + z)) * 0.7);
            float wet = smoothstep(vW + 0.08, vW + 0.01, z);
            alb *= 1.0 - wet * 0.45;
            wrap = 0.2; add = uSunCol * vis * spec * (0.06 + wet * 0.8) + skyLite(R) * wet * 0.12;
        } else if (mat == 1.0) {                                              // characters
            float rim = pow(1.0 - abs(dot(n, V)), 2.5);
            lv = max(vis, 0.45); wrap = 0.8;
            add = alb * uAmbT * 0.35 + alb * uSunCol * lv * (back * 0.5 + rim * 0.25) + skyLite(n) * rim * 0.12;
        } else if (mat == 15.0) {                                             // shadow creatures
            float rim = pow(1.0 - abs(dot(n, V)), 2.0);
            float fl = 0.7 + 0.3 * sin(uTime * 7.0 + vWorld.z * 9.0 + vWorld.x * 3.0);
            alb = vCol * (0.6 + 0.4 * vnoise(vWorld.xy * 8.0 + uTime));
            lv = 0.2; wrap = 0.5; add = vec3(0.7, 0.2, 1.0) * rim * 1.4 * fl + vec3(0.08, 0.02, 0.12);
        } else if (mat == 16.0) {                                             // metal
            float fres = 0.1 + 0.9 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
            wrap = 0.15; add = skyLite(R) * fres * alb * 1.2 + uSunCol * vis * pow(max(dot(R, uSun), 0.0), 60.0) * 0.8 + lights(R) * 0.25;
        } else if (mat == 2.0) {
            float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            wrap = 0.3; add = skyLite(R) * fres * 0.4 + uSunCol * vis * pow(max(dot(R, uSun), 0.0), 60.0) * 0.8;
        } else if (mat == 13.0) {
            lv = vis * 0.7 + 0.15;
            alb = vCol * (0.65 + 0.5 * vnoise(vec2(vWorld.x * 7.0 + vWorld.y * 7.0, vWorld.z * 1.2)) * (0.7 + 0.3 * vnoise(vWorld.xy * 30.0 + vWorld.z * 3.0)));
            wrap = 0.2; add = alb * uSunCol * back * 0.2 * lv;
        } else if (mat == 14.0) {
            lv = max(vis, 0.1);
            alb = vCol * (0.75 + 0.35 * vnoise(vec2((vWorld.x + vWorld.y) * 3.0, vWorld.z * 30.0)));
            wrap = 0.2;
        } else if (mat == 17.0) {
            alb = vCol * (0.85 + 0.2 * vnoise(vWorld.xy * 3.0 + vWorld.z * 2.0) + 0.1 * vnoise(vec2(vWorld.x + vWorld.y, vWorld.z) * 20.0));
            wrap = 0.3;
        }
        c = shade(alb, nn, wrap, lv) + add;
    }
    c = mix(c, vec3(2.4, 1.9, 1.9), uHit);
    gl_FragColor = vec4(tone(fogc(c, dist)), coc(dist));
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos"); gl.bindAttribLocation(program, space.colId, "col"); gl.bindAttribLocation(program, space.nrmId, "nrm");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, { program, cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"), xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"), varsLocation: loc("veriables") });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uTime", "uSun", "uSunCol", "uAmbT", "uAmbB", "uSkyTop", "uSkyHor", "uGlow", "uMisc", "uBolt", "uLights", "uLightCol", "uLightCount", "uShade", "uShadeRect", "uDof", "uBone", "uHit"]) U[n] = loc(n);
    return U;
}
