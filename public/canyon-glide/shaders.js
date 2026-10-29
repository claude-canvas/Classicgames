// Canyon Glide scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// World: metres, z up, the canyon runs along +y. A low sun (palette per biome, uniforms) + warm bounce light.
//
//   0 MATTE   misc                         1 GLOSS  glints
//   2 SCRUB   desert bushes                3 BG     sky: gradient, sun + glow, cirrus, stars when dark
//   4 SPRITE  additive glow · 5 EMIT · 6 SHADOW multiply · 7 ADD additive (rings, trails, god rays)
//   8 WATER   the river: sky + sun glitter  9 PAPER  the glider: crisp two-sided paper with fold lines
//  10 ROCK    sandstone: strata bands by height, desert varnish streaks, warm bounce from the canyon floor
//  11 FAR     distant mesas, hazed into the horizon

export const NEAR = 0.1, FAR = 4000.0;

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
uniform vec3 uAmb;
uniform vec3 uRockTint;
uniform float uNight;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.16), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 skyGrad(vec3 d) {
    float h = d.z;
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.02, 0.5, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSkyGlow * (pow(s, 5.0) * 0.6 + pow(s, 32.0) * 0.9);
    return mix(c, uSkyHor * 0.7, smoothstep(0.0, -0.3, h));
}
vec3 skyFull(vec3 d) {
    vec3 c = skyGrad(d);
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * smoothstep(0.9992, 0.9996, s) * 4.0;
    if (d.z > 0.0) {
        vec2 q = d.xy / (d.z + 0.1) * 0.6 + vec2(0.0, uTime * 0.004);
        float n = fbm(q * vec2(2.4, 0.6));
        float cl = smoothstep(0.52, 0.82, n) * smoothstep(0.0, 0.12, d.z) * smoothstep(0.85, 0.2, d.z);
        c = mix(c, mix(uSkyHor * 1.1, uSunCol * 1.3 + uSkyGlow * 0.4, pow(s, 3.0)), cl * 0.65);
        if (uNight > 0.01) { vec2 sp = vec2(atan(d.y, d.x) * 260.0, d.z * 260.0), g = floor(sp), f = fract(sp) - 0.5; c += vec3(step(0.993, hash12(g)) * smoothstep(0.25, 0.0, length(f))) * uNight * smoothstep(0.05, 0.3, d.z); }
    }
    return c;
}
vec3 shade(vec3 alb, vec3 n, float wrap) {
    float dl = max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0);
    vec3 bounce = uSunCol * 0.18 * max(-n.z * 0.5 + 0.5, 0.0) * (1.0 - smoothstep(10.0, 80.0, vWorld.z));   // warm light thrown back by the canyon floor
    return alb * (uAmb * (0.6 + 0.4 * n.z) + uSunCol * dl + bounce);
}
vec3 fog(vec3 c, float dist) {
    vec3 d = normalize(vWorld - cPoint);
    float f = 1.0 - exp(-dist * 0.0011);
    float hz = exp(-max(vWorld.z, 0.0) * 0.015) * 0.2 * (1.0 - exp(-dist * 0.004));     // low dusty haze in the canyon
    return mix(c, skyGrad(vec3(d.xy, max(d.z, 0.0) * 0.4)), clamp(f + hz, 0.0, 0.95));
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyFull(d));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.8); return;
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
    if (mat == 8.0) {
        vec2 q = vWorld.xy * 0.3 + vec2(0.0, -uTime * 0.6);
        vec3 wn = normalize(vec3((vnoise(q) - 0.5) * 0.25, (vnoise(q + 9.0) - 0.5) * 0.25, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        vec3 c = vCol * uAmb * 0.8 + skyGrad(R) * (0.25 + fres * 0.7) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 120.0) * 3.0;
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.8, 1.0, lum(o)) * 0.7); return;
    }
    if (mat == 9.0) {                                                    // paper
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
        vec3 c = shade(vCol, n, 0.35) + vCol * uSunCol * back * 0.5 + vCol * uAmb * 0.4;
        gl_FragColor = vec4(tone(c), 0.1); return;
    }
    if (mat == 10.0 || mat == 11.0) {                                    // sandstone
        float z = vWorld.z;
        float band = 0.78 + 0.22 * sin(z * 0.55 + vnoise(vWorld.xy * 0.02) * 4.0) + 0.1 * sin(z * 2.3 + 1.0) + 0.12 * (vnoise(vec2(z * 0.35, 3.0)) - 0.5);
        vec3 alb = vCol * uRockTint * band * (0.82 + 0.3 * vnoise(vWorld.xy * 0.15 + z * 0.1));
        float varnish = smoothstep(0.55, 0.8, vnoise(vec2(vWorld.x * 0.6 + vWorld.y * 0.6, z * 0.04))) * smoothstep(0.4, 0.1, abs(n.z));
        alb *= 1.0 - varnish * 0.45;
        alb = mix(alb, vec3(0.62, 0.52, 0.36) * uRockTint, smoothstep(0.85, 0.97, n.z) * 0.6);   // sandy ledges
        vec3 c = shade(alb, n, 0.2);
        vec3 o;
        if (mat == 11.0) { vec3 d = normalize(vWorld - cPoint); o = tone(mix(c, skyGrad(vec3(d.xy, 0.03)), clamp(1.0 - exp(-dist / 700.0), 0.0, 0.9))); }
        else o = tone(fog(c, dist));
        gl_FragColor = vec4(o, 0.0); return;
    }
    vec3 c = shade(vCol * (0.85 + 0.3 * vnoise(vWorld.xy * 2.0)), n, mat == 2.0 ? 0.6 : 0.2);
    gl_FragColor = vec4(tone(fog(c, dist)), 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uSunDir", "uSunCol", "uSkyTop", "uSkyHor", "uSkyGlow", "uAmb", "uRockTint", "uNight"]) U[n] = loc(n);
    return U;
}
