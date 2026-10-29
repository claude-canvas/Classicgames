// Paper Brook scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// Golden hour: a low sun (uSun) ahead of the camera, so most of the scene is backlit. Sunlight on the ground is
// multiplied by the baked dapple map (uShade). Alpha does not hold bloom here — it holds the depth-of-field circle
// of confusion (0 … 0.96), and the sky writes 1.0 so post.js can find it for god rays (see post.js / DESIGN.md §3).
//   0 MATTE  1 PAPER  2 LEAF  3 BG  4 SPRITE  5 EMIT  6 BOKEH  7 ADD  8 WATER  9 GROUND  10 ROCK  11 FOLIAGE
//  12 GRASS  13 BARK  14 WOOD  15 FOAM  16 SOFT (the rower)
//  WATER: vCol.r = s, vCol.g = x / half-width, vCol.b = tangent angle, pos.w = x (m). Flow speed = uniform uFlow.
export const NEAR = 0.03, FAR = 600.0;

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
    if (mat == 4.0 || mat == 6.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 12.0) {
        float w = pos.w * pos.w, ph = p.x * 1.3 + p.y * 0.9;
        p.xy += vec2(0.8, 0.35) * (sin(uTime * 1.3 + ph) + 0.4 * sin(uTime * 3.1 + ph * 2.3)) * w * 0.014;
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
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec3 uSun;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
uniform float uLightCount;
uniform sampler2D uShade;
uniform vec4 uShadeRect;
uniform vec3 uDof;
uniform float uFlow;

const vec3 SUNC = vec3(2.15, 1.82, 1.38);
const vec3 AMB_T = vec3(0.3, 0.36, 0.45);
const vec3 AMB_B = vec3(0.13, 0.13, 0.09);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.12), 0.0, 1.0); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 skyLite(vec3 d) {
    float h = d.z, s = max(dot(d, uSun), 0.0);
    vec3 c = mix(vec3(1.0, 0.87, 0.7), vec3(0.34, 0.55, 0.85), smoothstep(0.0, 0.5, h));
    c = mix(c, vec3(0.92, 0.74, 0.74), smoothstep(0.05, 0.2, h) * (1.0 - smoothstep(0.2, 0.5, h)) * 0.2);
    c += vec3(1.25, 1.05, 0.72) * (pow(s, 5.0) * 0.45 + pow(s, 30.0) * 0.8);
    return mix(c, vec3(0.4, 0.4, 0.33), smoothstep(0.0, -0.25, h));
}
vec3 sky(vec3 d) {
    vec3 c = skyLite(d); float s = max(dot(d, uSun), 0.0);
    c += vec3(4.0, 3.7, 3.0) * smoothstep(0.9975, 0.9988, s) + vec3(1.2, 1.0, 0.7) * pow(s, 400.0);
    if (d.z > 0.0) { vec2 q = d.xy / (d.z + 0.1) * 0.7 + vec2(uTime * 0.002, 0.0); float n = fbm(q * vec2(0.7, 1.6)); float cl = smoothstep(0.52, 0.8, n) * smoothstep(0.02, 0.12, d.z) * smoothstep(0.7, 0.2, d.z); c = mix(c, mix(vec3(0.95, 0.9, 0.92), vec3(2.0, 1.65, 1.2), pow(s, 3.0) + 0.2), cl * 0.65); }
    return c;
}
float sunVis(vec3 w) {
    vec2 uv = (w.xy - uShadeRect.xy) * uShadeRect.zw;
    float v = texture2D(uShade, uv).r;
    // leaves stir: the dapples shimmer a little
    v *= 0.88 + 0.12 * sin(uTime * 1.3 + w.x * 1.7 + w.y * 1.3) * sin(uTime * 0.7 + w.y * 2.1);
    return v;
}
vec3 lights(vec3 n) { vec3 acc = vec3(0.0); for (int i = 0; i < 6; i++) { if (float(i) >= uLightCount) break; vec3 L = uLights[i].xyz - vWorld; float d = length(L); acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 1.2) * (0.35 + 0.65 * max(dot(n, L / d), 0.0)); } return acc; }
vec3 amb(vec3 n) { return mix(AMB_B, AMB_T, n.z * 0.5 + 0.5); }
vec3 shade(vec3 alb, vec3 n, float wrap, float vis) { float dl = max((dot(n, uSun) + wrap) / (1.0 + wrap), 0.0); return alb * (amb(n) + SUNC * dl * vis + lights(n)); }
vec3 fogc(vec3 c, float dist) {
    vec3 d = normalize(vWorld - cPoint);
    vec3 hz = skyLite(vec3(d.xy, max(d.z, 0.0) * 0.35 + 0.02));
    float s = max(dot(d, uSun), 0.0);
    hz += vec3(0.3, 0.25, 0.15) * pow(s, 6.0);
    return mix(c, hz, clamp(1.0 - exp(-dist * 0.006), 0.0, 0.88));
}
float coc(float dist) {
    float nearB = clamp(uDof.x * 0.8 / dist - 1.0, 0.0, 1.0) * uDof.z;
    float farB = smoothstep(3.0, 75.0, dist) * uDof.y;
    return min(0.96, max(nearB, farB));
}
vec4 outc(vec3 c, float dist) { return vec4(tone(fogc(c, dist)), coc(dist)); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect))); gl_FragColor = vec4(tone(sky(d)), 1.0); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); gl_FragColor = vec4(vCol * k, 0.0); return; }
    if (mat == 6.0) { float r = length(vUV); float k = smoothstep(1.0, 0.86, r) * (0.55 + 0.45 * smoothstep(0.55, 0.92, r)); gl_FragColor = vec4(vCol * k, 0.0); return; }
    if (mat == 7.0) { gl_FragColor = vec4(vCol, 0.0); return; }
    float vis = sunVis(vWorld);
    if (mat == 15.0) {                                                        // foam (additive)
        vec2 uv = vCol.rg; float k = vCol.b;
        float f;
        if (vW > 0.5) { f = smoothstep(1.25, 0.6, abs(uv.x)) * (smoothstep(0.0, 0.4, uv.y) * exp(-uv.y * 0.55)); }
        else { float down = max(uv.y, 0.0), up = max(-uv.y, 0.0); float w = 1.0 + down * 0.12; f = smoothstep(w + 0.9, w * 0.95, length(vec2(uv.x, up * 1.3))) * exp(-down * 0.28) * smoothstep(-1.9, -1.2, uv.y); }
        vec2 q = vWorld.xy * 7.0;
        float fn = vnoise(q + vec2(uTime * 0.9, -uTime * 1.7)) * 0.6 + vnoise(q * 2.3 - vec2(uTime * 1.3, uTime * 0.4)) * 0.4;
        f *= smoothstep(0.38, 0.75, fn) * k;
        gl_FragColor = vec4(vec3(0.85, 0.8, 0.7) * (0.12 + 0.55 * vis) * f, 0.0); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    vec3 c;
    if (mat == 5.0) c = vCol;
    else if (mat == 8.0) {                                                    // water
        float s = vCol.r, q = vCol.g, ang = vCol.b, x = vW, t = uTime;
        vec2 T = vec2(cos(ang), sin(ang)), Rt = vec2(T.y, -T.x);
        float fl = uFlow;
        vec2 p = vec2(s - t * fl * 0.85, x);
        float e = 0.035;
        float h0 = 0.0, hs = 0.0, hx = 0.0;
        for (int k = 0; k < 3; k++) {
            vec2 sc = k == 0 ? vec2(0.7, 2.6) : k == 1 ? vec2(1.8, 5.5) : vec2(5.5, 11.0);
            vec2 off = k == 0 ? vec2(0.0) : k == 1 ? vec2(t * 0.35, 0.0) : -vec2(t * 0.6, t * 0.2);
            float a = k == 0 ? 0.55 : k == 1 ? 0.3 : 0.15;
            h0 += a * vnoise(p * sc + off); hs += a * vnoise((p + vec2(e, 0.0)) * sc + off); hx += a * vnoise((p + vec2(0.0, e)) * sc + off);
        }
        float amp = (0.032 + fl * 0.012) * mix(1.0, 0.35, smoothstep(4.0, 30.0, dist));
        vec2 g = ((hs - h0) * T + (hx - h0) * Rt) / e * amp;
        // fine glitter normals near the camera
        float gl2 = vnoise(vec2(s * 9.0 - t * fl * 7.0, x * 13.0)) - vnoise(vec2(s * 9.0 - t * fl * 7.0 + 0.3, x * 13.0 + 0.2));
        g += Rt * gl2 * 0.08 * smoothstep(12.0, 1.0, dist);
        vec3 ng = n.z < 0.0 ? -n : n;
        float steep = smoothstep(0.985, 0.85, ng.z);
        vec3 wn = normalize(vec3(-g + ng.xy * 2.0, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.025 + 0.975 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        // reflection: sky above a tree line that is low along the brook and high toward the banks
        vec2 Rh = normalize(R.xy + 1e-5);
        float along = abs(dot(Rh, T));
        float line = mix(0.34, 0.03, pow(along, 2.0)) + (vnoise(vec2(atan(Rh.y, Rh.x) * 14.0, s * 0.05)) - 0.5) * 0.12;
        float skyAmt = smoothstep(line - 0.12, line + 0.2, R.z);
        vec3 treeR = vec3(0.15, 0.15, 0.07) + vec3(1.0, 0.6, 0.25) * smoothstep(0.7, 0.95, vnoise(R.xy / (R.z + 0.2) * 9.0)) * 0.5;
        vec3 refl = mix(treeR, sky(R), skyAmt);
        // the pebble bed seen through shallow water
        float depth = max(0.02, (1.0 - q * q) * 0.32 + 0.02);
        vec2 vb = vec2(dot(-V.xy, T), dot(-V.xy, Rt)) / max(0.25, V.z);
        vec2 bp = vec2(s, x) + vb * depth * 0.75 + g * depth * 2.0;
        vec2 bc = bp * 4.2, bi = floor(bc), bf = fract(bc); float md = 9.0, id = 0.0;
        for (int k = 0; k < 9; k++) { vec2 o = vec2(mod(float(k), 3.0) - 1.0, floor(float(k) / 3.0) - 1.0); vec2 r = o + vec2(hash12(bi + o), hash12(bi + o + 17.3)) * 0.85 - bf; float dd = dot(r, r); if (dd < md) { md = dd; id = hash12(bi + o + 5.1); } }
        vec3 bed = mix(mix(vec3(0.36, 0.33, 0.27), vec3(0.62, 0.55, 0.42), id), vec3(0.45, 0.47, 0.5), step(0.7, hash12(bi + 3.3)) * 0.6) * (1.0 - smoothstep(0.25, 0.5, sqrt(md)) * 0.55);
        bed *= 0.8 + 0.3 * vnoise(bp * 23.0);
        float caus = pow(abs(sin(bp.x * 9.0 + h0 * 6.0 - t * 2.0) * sin(bp.y * 8.0 + hs * 6.0 + t * 1.3)), 6.0);
        vec3 bedLit = bed * (AMB_T * 0.55 + SUNC * vis * (0.55 + caus * 1.4) * 0.6);
        vec3 tr = exp(-depth * vec3(6.0, 3.0, 3.5));
        vec3 scat = vec3(0.05, 0.11, 0.1) * (AMB_T * 1.4 + SUNC * vis * 0.5);
        c = mix(bedLit * tr + scat * (1.0 - tr), refl, fres * 0.78);
        float sp = max(dot(R, uSun), 0.0);
        c += SUNC * (0.25 + vis) * (pow(sp, 900.0) * 16.0 + pow(sp, 90.0) * 0.3 + pow(sp, 10.0) * 0.03);
        // flow streaks in faster water and white water on cascade slopes
        float streak = smoothstep(0.62, 0.85, vnoise(vec2(s * 0.7 - t * fl * 1.1, x * 7.0))) * smoothstep(2.2, 3.4, fl) * 0.35;
        float froth = max(steep * smoothstep(0.35, 0.65, vnoise(vec2(s * 3.0 - t * 4.0, x * 6.0))), streak);
        c = mix(c, vec3(0.92, 0.88, 0.8) * (AMB_T * 1.4 + SUNC * vis * 0.6), clamp(froth * 0.9, 0.0, 1.0));
        // dark wet edge where water meets the banks
        c *= 1.0 - 0.35 * smoothstep(0.85, 1.05, abs(q));
    } else {
        // every other surface: pick albedo / normal / wrap / sun visibility / extra light, then shade once
        float back = pow(max(dot(-V, uSun), 0.0), 3.0);
        vec3 alb = vCol, nn = n, add = vec3(0.0);
        float wrap = 0.25, lv = vis;
        vec3 R = reflect(-V, n);
        float spec = pow(max(dot(R, uSun), 0.0), 40.0);
        if (mat == 9.0) {                                                     // ground
            float d = vW, slope = 1.0 - n.z;
            vec2 w = vWorld.xy;
            vec3 grass = mix(vec3(0.17, 0.27, 0.05), vec3(0.34, 0.42, 0.1), vnoise(w * 0.35)) * (0.75 + 0.45 * vnoise(w * 3.1));
            vec3 soil = vec3(0.24, 0.18, 0.1) * (0.75 + 0.45 * vnoise(w * 2.2));
            alb = mix(soil, grass, smoothstep(0.45, 0.15, slope));
            alb = mix(vec3(0.09, 0.08, 0.05), alb, smoothstep(-0.1, 0.18, d));
            alb = mix(alb, vec3(0.42, 0.36, 0.22), smoothstep(0.7, 0.9, vnoise(w * 0.12)) * 0.3) * vCol;
            wrap = 0.35; add = alb * SUNC * vis * back * 0.35;
        } else if (mat == 12.0) {                                             // grass blades
            nn = normalize(n + vec3(0.0, 0.0, 0.8));
            alb = vCol * (0.85 + 0.3 * hash12(floor(vWorld.xy * 40.0)));
            wrap = 0.6; add = alb * SUNC * vis * (back * 1.5 + 0.12) * (0.3 + vW) + alb * AMB_T * 0.25 * vW;
        } else if (mat == 11.0) {                                             // canopy, bushes, ferns
            float edge = 1.0 - abs(dot(n, V));
            float holes = vnoise(vWorld.xy * 9.0 + vWorld.z * 5.0) * 0.6 + vnoise(vWorld.yz * 19.0 + vWorld.x * 7.0) * 0.4;
            if (holes < 0.2 + edge * 0.6 && dist > 1.2) discard;
            lv = max(vis, 0.3) * (0.55 + 0.45 * vnoise(vWorld.xy * 0.7 + vWorld.z));
            alb = vCol * (0.7 + 0.45 * vnoise(vWorld.xy * 6.0 + vWorld.z * 4.0));
            wrap = 0.6; add = alb * SUNC * (back * 1.8 * (0.4 + edge) + 0.05) * lv;
        } else if (mat == 10.0) {                                             // stone
            float z = vWorld.z;
            alb = vCol * (0.7 + 0.45 * fbm(vWorld.xy * 3.0 + z * 2.0));
            alb *= 1.0 - 0.22 * smoothstep(0.025, 0.0, abs(vnoise(vWorld.xy * 7.0 + z * 6.0) - 0.5));                      // cracks
            alb = mix(alb, vec3(0.74, 0.74, 0.58), smoothstep(0.74, 0.8, vnoise(vWorld.xy * 14.0 + z * 11.0)) * smoothstep(vW + 0.15, vW + 0.35, z) * 0.55); // lichen
            alb = mix(alb, vec3(0.1, 0.17, 0.05), smoothstep(vW - 0.03, vW + 0.03, z) * smoothstep(vW + 0.26, vW + 0.05, z) * (0.4 + 0.4 * vnoise(vWorld.xy * 9.0 + z * 20.0))); // algae line
            alb = mix(alb, vec3(0.2, 0.28, 0.08) * (0.8 + 0.4 * vnoise(vWorld.xy * 6.0)), smoothstep(0.55, 0.85, n.z) * smoothstep(0.4, 0.65, vnoise(vWorld.xy * 2.5 + z)) * 0.8);
            float wet = smoothstep(vW + 0.06, vW + 0.01, z);
            alb *= 1.0 - wet * 0.45;
            wrap = 0.2; add = SUNC * vis * spec * (0.08 + wet * 0.8) + skyLite(R) * wet * 0.12 + alb * SUNC * vis * back * 0.2;
        } else if (mat == 1.0) {                                              // paper
            lv = max(vis, 0.25); wrap = 0.5; add = alb * SUNC * lv * back * 0.9 + alb * vec3(0.22, 0.19, 0.15);
        } else if (mat == 2.0) {                                              // lily pads, leaves
            float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            alb = vCol * (0.8 + 0.3 * vnoise(vWorld.xy * 20.0));
            wrap = 0.3; add = skyLite(R) * fres * 0.4 + SUNC * vis * pow(max(dot(R, uSun), 0.0), 60.0) * 0.8 + alb * SUNC * vis * back * 0.8;
        } else if (mat == 13.0) {                                             // bark
            lv = vis * 0.7 + 0.15;
            alb = vCol * (0.65 + 0.5 * vnoise(vec2(vWorld.x * 7.0 + vWorld.y * 7.0, vWorld.z * 1.2)) * (0.7 + 0.3 * vnoise(vWorld.xy * 30.0 + vWorld.z * 3.0)));
            wrap = 0.2; add = alb * SUNC * back * 0.25 * lv;
        } else if (mat == 16.0) {                                             // soft (Pip): wrapped light, warm fill, rim
            float rim = pow(1.0 - abs(dot(n, V)), 2.5);
            lv = max(vis, 0.45); wrap = 0.85;
            add = alb * vec3(0.2, 0.18, 0.16) + alb * SUNC * lv * (back * 0.6 + rim * 0.25) + vec3(1.0, 0.95, 0.85) * rim * 0.08;
        } else if (mat == 14.0) {                                             // wood
            lv = max(vis, 0.1);
            alb = vCol * (0.75 + 0.35 * vnoise(vec2((vWorld.x + vWorld.y) * 3.0, vWorld.z * 30.0)));
            wrap = 0.2;
        }
        c = shade(alb, nn, wrap, lv) + add;
    }
    gl_FragColor = outc(c, dist);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos"); gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, { program, cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"), xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"), varsLocation: loc("veriables") });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uTime", "uSun", "uLights", "uLightCol", "uLightCount", "uShade", "uShadeRect", "uDof", "uFlow"]) U[n] = loc(n);
    return U;
}
