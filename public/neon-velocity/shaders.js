// Neon Velocity scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
//   0 MATTE  dark structure          1 HULL  glossy ship paint: env reflection of the neon sky + clear-coat
//   2 GLASS  barrier walls / canopies (additive pass): Fresnel + neon tint
//   3 BG     sky: violet → teal, stars, a ringed planet, city glow on the horizon
//   4 SPRITE · 5 EMIT neon tubes · 7 ADD
//   8 ROAD   dark glass road: lane lines, edge strips, scrolling chevrons on boost pads (vCol.r = s, pos.w = x)
//   9 CITY   tower facades: procedural lit window grid    10 METAL pylons / arches
export const NEAR = 0.1, FAR = 6000.0;

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
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

const vec3 PLANET = vec3(0.55, 0.78, 0.3);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.35); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.2), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 skyLite(vec3 d) {
    float h = d.z;
    vec3 c = mix(vec3(0.16, 0.05, 0.22), vec3(0.01, 0.01, 0.05), smoothstep(-0.05, 0.6, h));
    c += vec3(0.05, 0.35, 0.45) * exp(-max(h, 0.0) * 9.0) * 0.6 + vec3(0.6, 0.15, 0.4) * exp(-abs(h) * 22.0) * 0.5;
    return c;
}
vec3 sky(vec3 d) {
    vec3 c = skyLite(d);
    if (d.z > 0.0) {
        vec2 sp = vec2(atan(d.y, d.x) * 280.0, d.z * 280.0), g = floor(sp), f = fract(sp) - 0.5;
        c += vec3(step(0.99, hash12(g)) * smoothstep(0.25, 0.0, length(f)) * smoothstep(0.05, 0.3, d.z)) * 0.8;
    }
    // the ringed planet
    vec3 P = normalize(PLANET); float m = dot(d, P);
    if (m > 0.97) { float r = sqrt(max(0.0, 1.0 - m * m)) / 0.243; vec3 q = d - P * m; float band = sin(dot(q, vec3(0.3, -0.5, 0.8)) * 220.0) * 0.5 + 0.5; c = mix(c, mix(vec3(0.6, 0.3, 0.7), vec3(0.95, 0.6, 0.5), band) * (0.4 + 0.6 * smoothstep(1.0, 0.2, r)) * (0.5 + 0.5 * dot(normalize(q + P * 0.2), normalize(vec3(-0.5, 0.2, 0.3)))), smoothstep(1.0, 0.97, r)); c += vec3(0.4, 0.3, 0.6) * smoothstep(1.15, 1.0, r) * (1.0 - smoothstep(1.0, 0.97, r)); }
    vec3 rn = normalize(vec3(0.15, -0.25, 1.0)); float rd = dot(d - P * m, rn); float rr = length(d - P * m - rn * rd) / 0.243;
    if (m > 0.9 && abs(rd) < 0.004 && rr > 1.3 && rr < 2.2) c += vec3(0.5, 0.4, 0.6) * (0.4 + 0.3 * sin(rr * 40.0)) * 0.6;
    return c;
}
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) { if (float(i) >= uLightCount) break; vec3 L = uLights[i].xyz - vWorld; float d = length(L); acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.08) * (0.3 + 0.7 * max(dot(n, L / d), 0.0)); }
    return acc;
}
vec3 fogc(vec3 c, float dist) { vec3 d = normalize(vWorld - cPoint); return mix(c, skyLite(vec3(d.xy, max(d.z, 0.0) * 0.3)), clamp((1.0 - exp(-dist * 0.0012)) * 0.9 + smoothstep(10.0, -60.0, vWorld.z) * 0.3, 0.0, 0.95)); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect))); vec3 o = tone(sky(d)); gl_FragColor = vec4(o, smoothstep(0.6, 1.0, lum(o)) * 0.5); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(fogc(vCol, dist * 0.5)), 0.95); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 8.0) {                                                        // road
        float s = vCol.r, x = vW;
        float lanes = smoothstep(0.08, 0.0, abs(fract((x + 11.0) / 5.5 + 0.5) - 0.5) * 5.5 - 0.0) * step(abs(x), 10.0) * step(0.5, fract(s / 8.0));
        float edge = smoothstep(0.35, 0.0, abs(abs(x) - 10.4));
        float grid = smoothstep(0.06, 0.0, abs(fract(s / 4.0) - 0.5) * 4.0 - 1.9);
        float chev = vCol.g * step(0.5, fract((s - abs(x) * 0.6) / 2.4 - uTime * 2.5));
        vec3 R = reflect(-V, n);
        vec3 c = vec3(0.015, 0.012, 0.03) + skyLite(R) * 0.35 * (0.3 + 0.7 * pow(1.0 - max(dot(n, V), 0.0), 3.0));
        c += vec3(0.1, 0.8, 1.0) * lanes * 0.6 + mix(vec3(1.0, 0.2, 0.7), vec3(0.2, 0.9, 1.0), step(0.0, x)) * edge * 1.6 + vec3(0.25, 0.15, 0.5) * grid * 0.12;
        c += vec3(1.0, 0.6, 0.1) * chev * 1.4 + vec3(1.0, 0.5, 0.05) * vCol.g * 0.15;
        c += lights(n) * 0.25;
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, clamp(edge + lanes * 0.5 + chev, 0.0, 1.0) * 0.8); return;
    }
    if (mat == 9.0) {                                                        // tower facade
        vec2 q = vec2(dot(vWorld.xy, normalize(vec2(-n.y, n.x) + 1e-4)) / 2.2, vWorld.z / 3.2);
        vec2 cell = floor(q), f = fract(q);
        float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8) * step(0.45, hash12(cell + vCol.xy * 50.0));
        vec3 wc = mix(vec3(0.3, 0.8, 1.0), vec3(1.0, 0.55, 0.85), step(0.6, hash12(cell * 1.7 + 3.0)));
        vec3 c = vCol * 0.05 + wc * win * (0.35 + 0.5 * hash12(cell + 9.0)) * (0.8 + 0.2 * sin(uTime + cell.x));
        c *= step(0.1, abs(n.x) + abs(n.y));
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, win * 0.4); return;
    }
    if (mat == 2.0) { float f = pow(1.0 - abs(dot(n, V)), 2.0); vec3 c = vCol * (0.06 + f * 0.8) + skyLite(reflect(-V, n)) * f * 0.6; gl_FragColor = vec4(tone(fogc(c, dist)), lum(c) * 0.4); return; }
    if (mat == 1.0) {                                                        // ship paint
        vec3 R = reflect(-V, n); float f = 0.06 + 0.94 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 c = vCol * (0.1 + lights(n) * 0.6 + max(n.z, 0.0) * 0.12) + sky(R) * (0.25 + f * 0.9) + vec3(1.0) * pow(max(dot(R, normalize(vec3(0.3, 0.6, 0.7))), 0.0), 60.0) * 0.6;
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.15); return;
    }
    vec3 R = reflect(-V, n);
    vec3 c = vCol * (0.08 + lights(n) * 0.5) + skyLite(R) * (mat == 10.0 ? 0.35 : 0.12);
    gl_FragColor = vec4(tone(fogc(c, dist)), 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
