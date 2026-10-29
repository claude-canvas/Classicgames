// Wisp Siege scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// World: metres, z up; the island's tiles sit at z = 0. Moonlight + up to 8 coloured point lights (beam pools,
// crystals, blooming lotuses).
//
//   0 MATTE   stone tiles, pedestals, island rock (pos.w = moss amount on top faces)
//   1 GLOSS   bronze frames                     2 MOSS  moss, lily pads, leaves (wrap light)
//   3 BG      night sky: indigo gradient, nebula band, stars, moon, a sea of clouds below the horizon
//   4 SPRITE  additive glow · 5 EMIT emissive (crystals) · 6 SHADOW multiply · 7 ADD additive (beams)
//   8 WATER   basins and falls (sky reflection + ripple)  9 GLASS  drawn additively: Fresnel rim + tint
//  10 PETAL   lotus petals: pale, translucent, glowing with vCol × pos.w when blooming
//  11 MIRROR  polished mirror face: reflects the sky

export const NEAR = 0.05, FAR = 3000.0;

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
uniform vec3 uMoonDir;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;
uniform float uWin;

const vec3 MOONC = vec3(0.5, 0.55, 0.78);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.35); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.15), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 skyLite(vec3 d) {
    float h = d.z;
    vec3 c = mix(vec3(0.06, 0.05, 0.16), vec3(0.008, 0.01, 0.04), smoothstep(-0.1, 0.7, h));
    c += vec3(0.12, 0.08, 0.2) * exp(-abs(h) * 6.0);
    return c;
}
vec3 skyFull(vec3 d) {
    vec3 c = skyLite(d);
    float h = d.z;
    if (h > -0.05) {
        // nebula band + stars
        vec2 q = vec2(atan(d.y, d.x) * 2.0, h * 4.0);
        float band = exp(-pow((h - 0.35 - 0.15 * sin(q.x * 0.7)) * 3.5, 2.0));
        float n = fbm(q * 1.5 + vec2(uTime * 0.005, 0.0));
        c += mix(vec3(0.25, 0.08, 0.35), vec3(0.05, 0.2, 0.4), n) * band * n * 0.9;
        vec2 sp = vec2(atan(d.y, d.x) * 300.0, h * 300.0), g = floor(sp), f = fract(sp) - 0.5;
        float st = step(0.991, hash12(g)) * smoothstep(0.25, 0.0, length(f)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash12(g + 3.0) * 40.0));
        c += vec3(0.9, 0.9, 1.0) * st * smoothstep(-0.02, 0.15, h);
        float m = dot(d, uMoonDir);
        c += vec3(0.95, 0.95, 0.88) * (smoothstep(0.9993, 0.9996, m) * 2.0 + pow(max(m, 0.0), 40.0) * 0.15);
    }
    if (h < 0.02) {                                                  // sea of clouds far below
        vec2 q = d.xy / (0.08 - h) * 0.6 + vec2(uTime * 0.01, 0.0);
        float cl = fbm(q);
        c = mix(c, vec3(0.05, 0.05, 0.14) * (0.4 + cl * 1.3) + MOONC * 0.22 * pow(cl, 3.0) + vec3(0.12, 0.06, 0.18) * exp(h * 8.0), smoothstep(0.02, -0.08, h) * 0.95);
    }
    return c;
}
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 1.2) * (0.3 + 0.7 * max(dot(n, l), 0.0));
    }
    return acc;
}
vec3 shade(vec3 alb, vec3 n, float wrap) {
    float dl = max((dot(n, uMoonDir) + wrap) / (1.0 + wrap), 0.0);
    return alb * (mix(vec3(0.05, 0.04, 0.09), vec3(0.12, 0.13, 0.24), n.z * 0.5 + 0.5) + MOONC * dl * 0.7 + lights(n));
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyFull(d));
        gl_FragColor = vec4(o, smoothstep(0.6, 1.0, lum(o)) * 0.6); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.1, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { vec3 o = tone(vCol * (1.0 + 0.15 * sin(uTime * 3.0 + vWorld.x * 2.0))); gl_FragColor = vec4(o, 0.9); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 9.0) {                                                // glass (additive pass)
        float f = pow(1.0 - abs(dot(n, V)), 2.5);
        vec3 R = reflect(-V, n);
        vec3 c = vCol * (0.08 + f * 0.6) + skyLite(R) * f * 0.8 + lights(n) * vCol * 0.15 + MOONC * pow(max(dot(R, uMoonDir), 0.0), 40.0) * 0.6;
        gl_FragColor = vec4(tone(c), lum(c) * 0.5); return;
    }
    if (mat == 11.0) {                                               // mirror face
        vec3 R = reflect(-V, n);
        vec3 c = skyFull(R) * 0.85 + vec3(0.08, 0.07, 0.06) + lights(n) * 0.25;
        gl_FragColor = vec4(tone(c), smoothstep(0.5, 1.0, lum(tone(c))) * 0.4); return;
    }
    if (mat == 8.0) {
        vec2 q = vWorld.xy * 6.0 + uTime * 0.4;
        vec3 wn = normalize(vec3((vnoise(q) - 0.5) * 0.3, (vnoise(q + 7.0) - 0.5) * 0.3, 1.0));
        vec3 R = reflect(-V, wn);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        vec3 c = vCol * 0.2 + skyLite(R) * (0.3 + fres * 0.7) + lights(wn) * 0.3;
        gl_FragColor = vec4(tone(c), 0.1); return;
    }
    if (mat == 10.0) {                                               // lotus petal
        float back = pow(max(dot(-V, normalize(vec3(0.0, 0.0, 1.0))), 0.0), 2.0);
        vec3 pale = mix(vec3(0.95, 0.82, 0.9), vec3(1.0, 0.97, 0.95), vnoise(vWorld.xy * 30.0));
        vec3 c = shade(pale * 0.7, n, 0.8) + vCol * vW * (1.2 + 0.2 * sin(uTime * 4.0)) + vCol * vW * back * 0.6;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, clamp(vW * 0.9, 0.0, 1.0)); return;
    }
    if (mat == 2.0) {
        vec3 alb = vCol * (0.75 + 0.45 * vnoise(vWorld.xy * 9.0 + vWorld.z * 4.0));
        gl_FragColor = vec4(tone(shade(alb, n, 0.6)), 0.0); return;
    }
    if (mat == 1.0) {
        vec3 R = reflect(-V, n);
        vec3 c = shade(vCol * 0.55, n, 0.1) + vCol * skyLite(R) * 1.4 + vCol * lights(n) * pow(max(dot(R, vec3(0.0, 0.0, 1.0)), 0.0), 4.0) * 0.6 + MOONC * vCol * pow(max(dot(R, uMoonDir), 0.0), 30.0);
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    // stone with moss on top faces
    vec3 alb = vCol * (0.78 + 0.35 * vnoise(vWorld.xy * 4.0 + vWorld.z * 3.0)) * (0.9 + 0.15 * vnoise(vWorld.xy * 22.0));
    float moss = vW * smoothstep(0.6, 0.95, n.z) * smoothstep(0.62, 0.85, vnoise(vWorld.xy * 2.6 + 3.0)) * 0.85;
    alb = mix(alb, vec3(0.16, 0.32, 0.14) * (0.8 + 0.4 * vnoise(vWorld.xy * 15.0)), moss);
    gl_FragColor = vec4(tone(shade(alb, n, 0.2)), 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uMoonDir", "uLights", "uLightCol", "uLightCount", "uWin"]) U[n] = loc(n);
    return U;
}
