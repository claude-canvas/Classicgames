// Frost Stone scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// World: metres, z up; the sheet runs along +y (hack at y = 0, button at y = 36).
//
//   0 MATTE   wood, rock, pine needles     1 GLOSS  lacquer, handles, brass
//   2 SNOW    snow: soft wrap light + view-dependent sparkle
//   3 BG      night sky: stars, Milky Way, animated aurora curtains, horizon glow
//   4 SPRITE  additive glow · 5 EMIT emissive · 6 SHADOW multiply · 7 ADD additive
//   8 ICE     blended over mirrored geometry: Fresnel sky + aurora reflection, house rings, pebble glints,
//             snow dust off the sheet, dark depth (alpha = how much reflection shows through)
//   9 PAPER   lantern paper lit from inside (pos.w = glow)
//  10 STONE   polished speckled granite
//  11 FAR     distant snowy mountains with atmospheric haze

export const NEAR = 0.05, FAR = 5000.0;
export const TEE = 36.0;

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

const vec3 MOONC = vec3(0.42, 0.5, 0.72);
const vec3 AMB_T = vec3(0.09, 0.12, 0.2);
const vec3 AMB_B = vec3(0.04, 0.05, 0.08);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.35); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.15), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }

// aurora: a few vertical curtains whose footprint wanders across the sky
vec3 aurora(vec3 d, bool full) {
    if (d.z < 0.02) return vec3(0.0);
    vec2 q = d.xy / (d.z + 0.15);                       // project onto a high layer
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float band = q.y * (0.5 + fi * 0.18) + sin(q.x * (0.9 + fi * 0.3) + uTime * (0.07 + fi * 0.03) + fi * 2.0) * 0.55 + (full ? fbm(vec2(q.x * 0.8 + uTime * 0.03, fi)) : vnoise(vec2(q.x * 0.8 + uTime * 0.03, fi)) * 0.94) * 0.9 - 1.6 - fi * 0.45;
        float curtain = exp(-band * band * 9.0);
        float rays = full ? 0.55 + 0.45 * vnoise(vec2(q.x * 14.0 + fi * 7.0, uTime * 0.5)) : 0.78;
        float height = smoothstep(0.02, 0.18, d.z) * (1.0 - smoothstep(0.35, 0.85, d.z));
        vec3 col = mix(vec3(0.1, 1.0, 0.55), vec3(0.65, 0.3, 1.0), smoothstep(0.15, 0.6, d.z) + fi * 0.15);
        acc += col * curtain * rays * height * (0.55 - fi * 0.12);
    }
    return acc;
}
vec3 skyCol(vec3 d, bool full) {
    float h = d.z;
    vec3 c = mix(vec3(0.05, 0.08, 0.16), vec3(0.008, 0.012, 0.035), smoothstep(0.0, 0.6, h));
    c += vec3(0.08, 0.12, 0.16) * exp(-max(h, 0.0) * 14.0);          // horizon glow
    c += aurora(d, full) * (full ? 1.0 : 0.8);
    if (full) {
        vec2 sp = vec2(atan(d.y, d.x) * 300.0, h * 300.0), g = floor(sp), f = fract(sp) - 0.5;
        vec2 jit = vec2(hash12(g + 7.0), hash12(g + 13.0)) - 0.5;
        float st = step(0.992, hash12(g)) * smoothstep(0.25, 0.0, length(f - jit * 0.5)) * (0.5 + 0.5 * sin(uTime * 2.5 + hash12(g + 3.0) * 40.0));
        c += vec3(st) * smoothstep(0.0, 0.25, h) * 0.9;
        float m = dot(d, uMoonDir);
        c += vec3(0.95, 0.95, 0.88) * (smoothstep(0.9996, 0.99975, m) * 2.5 + pow(max(m, 0.0), 60.0) * 0.12);
    }
    return c;
}
// cheap sky (no aurora) for fog and small reflections; keeps the shader compile fast
vec3 skyLite(vec3 d) { float h = d.z; return mix(vec3(0.05, 0.08, 0.16), vec3(0.008, 0.012, 0.035), smoothstep(0.0, 0.6, h)) + vec3(0.08, 0.12, 0.16) * exp(-max(h, 0.0) * 14.0) + vec3(0.02, 0.06, 0.05) * smoothstep(0.05, 0.3, h); }
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.35) * (0.25 + 0.75 * max(dot(n, l), 0.0));
    }
    return acc;
}
vec3 shade(vec3 alb, vec3 n, float wrap) {
    float dl = max((dot(n, uMoonDir) + wrap) / (1.0 + wrap), 0.0);
    return alb * (mix(AMB_B, AMB_T, n.z * 0.5 + 0.5) + MOONC * dl * 0.75 + lights(n));
}
vec3 fogc(vec3 c, float dist) { vec3 d = normalize(vWorld - cPoint); return mix(c, skyLite(vec3(d.xy, max(d.z, 0.0) * 0.3)), smoothstep(60.0, 1500.0, dist) * 0.9); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyCol(d, true));
        gl_FragColor = vec4(o, smoothstep(0.55, 1.0, lum(o)) * 0.7); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.15, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
    if (mat == 8.0) {                                                  // ice
        vec2 p = vWorld.xy;
        float sheet = 1.0 - smoothstep(2.35, 2.6, abs(p.x));
        vec3 n = normalize(vec3((vnoise(p * 3.0) - 0.5) * 0.02, (vnoise(p * 3.0 + 9.0) - 0.5) * 0.02, 1.0));
        vec3 R = reflect(-V, n);
        float fres = 0.08 + 0.92 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 refl = skyCol(vec3(R.xy, abs(R.z)), false);
        vec3 Lup = lights(vec3(0.0, 0.0, 1.0));
        vec3 deep = vec3(0.02, 0.06, 0.09) + Lup * 0.25 * sheet;
        // house rings and lines painted under the ice
        float r = length(p - vec2(0.0, ${TEE.toFixed(1)}));
        vec3 paint = vec3(0.0); float pa = 0.0;
        if (r < 1.83 && r > 1.22) { paint = vec3(0.1, 0.25, 0.75); pa = 0.8; }
        if (r < 0.61 && r > 0.15) { paint = vec3(0.75, 0.12, 0.1); pa = 0.8; }
        if (r <= 1.22 && r >= 0.61 || r <= 0.15) { paint = vec3(0.85, 0.88, 0.9); pa = 0.55; }
        if (r > 1.83) pa = 0.0;
        float line = (1.0 - smoothstep(0.015, 0.03, abs(p.y - 30.0))) * 0.9 + (1.0 - smoothstep(0.012, 0.024, abs(p.y - ${TEE.toFixed(1)}))) * 0.5 + (1.0 - smoothstep(0.012, 0.024, abs(p.x))) * 0.35 * step(${TEE.toFixed(1)} - 6.5, p.y) + (1.0 - smoothstep(0.015, 0.03, abs(p.y - 37.83))) * 0.5;
        if (line > 0.0) { paint = mix(paint, p.y > 29.0 && p.y < 31.0 ? vec3(0.8, 0.12, 0.1) : vec3(0.75, 0.78, 0.82), min(1.0, line)); pa = max(pa, line * 0.7); }
        pa *= sheet;
        vec3 base = mix(deep, paint * (0.12 + Lup * 0.6 + MOONC * 0.08), pa);
        // pebble glints and snow dust off the sheet
        float glint = step(0.996, hash12(floor(p * 90.0))) * pow(max(dot(R, normalize(uMoonDir + vec3(0.0, 0.0, 0.3))), 0.0), 4.0) * sheet;
        float dust = (1.0 - sheet) * (0.55 + 0.45 * vnoise(p * 0.4));
        vec3 c = base + refl * fres * (1.0 - dust * 0.7) + vec3(0.9, 0.95, 1.0) * glint * 0.8;
        c = mix(c, vec3(0.8, 0.86, 0.95) * (AMB_T + MOONC * max((uMoonDir.z + 0.3) / 1.3, 0.0) * 0.75 + Lup) * (0.85 + 0.15 * vnoise(p * 2.0)), dust * 0.75);
        vec3 o = tone(fogc(c, dist));
        float alpha = clamp(0.72 + dust * 0.28 + pa * 0.2 - fres * 0.25, 0.0, 1.0);
        gl_FragColor = vec4(o, alpha); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {                                                  // snow
        vec3 c = shade(vCol * (0.9 + 0.1 * vnoise(vWorld.xy * 3.0)), n, 0.5);
        float sp = step(0.985, hash12(floor(vWorld.xy * 40.0 + vWorld.z * 30.0))) * pow(max(dot(reflect(-V, n), uMoonDir), 0.0), 2.0);
        c += vec3(0.8, 0.9, 1.0) * sp * 1.5 + lights(n) * vCol * 0.2;
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, sp * 0.6); return;
    }
    if (mat == 9.0) {
        vec3 inner = vCol * vW * (1.0 + 0.12 * sin(uTime * 11.0 + vWorld.x * 3.0));
        vec3 o = tone(shade(vCol, n, 0.6) + inner);
        gl_FragColor = vec4(o, smoothstep(0.5, 1.0, lum(o)) * min(1.0, vW)); return;
    }
    if (mat == 10.0) {                                                 // granite
        float sp = vnoise(vWorld.xy * 60.0 + vWorld.z * 51.0);
        vec3 alb = vCol * (0.9 + 0.2 * sp);
        vec3 R = reflect(-V, n);
        vec3 c = shade(alb, n, 0.2) + skyLite(vec3(R.xy, abs(R.z))) * 0.35 * (0.2 + 0.8 * pow(1.0 - max(dot(n, V), 0.0), 3.0));
        c += lights(n) * 0.12 * pow(max(dot(R, vec3(0.0, 0.0, 1.0)), 0.0), 8.0);
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, 0.0); return;
    }
    if (mat == 11.0) {
        vec3 alb = mix(vec3(0.16, 0.18, 0.24), vec3(0.75, 0.8, 0.9), smoothstep(vW * 0.5, vW, vWorld.z + vnoise(vWorld.xy * 0.02) * 60.0));
        vec3 c = shade(alb, n, 0.3);
        float haze = 1.0 - exp(-dist / 1200.0);
        vec3 d = normalize(vWorld - cPoint);
        c = mix(c, skyLite(vec3(d.xy, 0.03)), clamp(haze, 0.0, 0.85));
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    vec3 c = shade(vCol, n, 0.25);
    if (mat == 1.0) { vec3 R = reflect(-V, n); c += skyLite(vec3(R.xy, abs(R.z))) * 0.25 + lights(n) * pow(max(dot(R, vec3(0.0, 0.0, 1.0)), 0.0), 6.0) * 0.3; }
    vec3 o = tone(fogc(c, dist));
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
    for (const n of ["aspect", "veriables", "uTime", "uMoonDir", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
