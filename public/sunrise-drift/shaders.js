// Sunrise Drift scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// World: metres, z up.
//
//   0 MATTE    houses, wood, wicker          1 GLOSS  burner metal (pos.w = metalness)
//   2 FOLIAGE  poplars, trees: wrap light + backlit translucency against the low sun
//   3 BG       sky: time-of-day gradient, sun disc + glow, high cirrus lit from below, stars at night
//   4 SPRITE   additive glow · 5 EMIT emissive · 6 SHADOW multiply · 7 ADD additive
//   8 WATER    river: sky reflection with ripples + sun glitter
//   9 ENVELOPE balloon fabric: wrap light, sun shining through the fabric, burner glow from inside (pos.w)
//  10 TERRAIN  tuff ground with strata and grain; pos.w = 1 for fields (vine rows / furrows)
//  11 ROCK     fairy chimneys: horizontal tuff bands + erosion streaks (pos.w = tower height)
//  12 FAR      far mountains with haze; pos.w = peak height for the snow line
// Height mist (uMist) pools in the valley in the early morning.

export const NEAR = 0.3, FAR = 9000.0;

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
uniform float uMist;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

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
    c += uSkyGlow * (pow(s, 4.0) * 0.55 + pow(s, 24.0) * 0.9) * (1.0 - uNight * 0.7);
    c = mix(c, uSkyHor * 0.6, smoothstep(0.0, -0.25, h));
    return c;
}
vec3 skyFull(vec3 d) {
    vec3 c = skyGrad(d);
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * smoothstep(0.9990, 0.9995, s) * 5.0 * (1.0 - uNight);
    if (d.z > 0.0) {                         // cirrus streaks lit from below
        vec2 q = d.xy / (d.z + 0.1) * 0.7 + vec2(uTime * 0.003, 0.0);
        float n = fbm(q * vec2(0.5, 2.6));
        float cl = smoothstep(0.5, 0.82, n) * smoothstep(0.0, 0.1, d.z) * smoothstep(0.8, 0.2, d.z);
        vec3 lit = mix(uSkyHor * 1.15, uSunCol * 1.5 + uSkyGlow * 0.4, pow(s, 2.5)) * (1.0 - uNight * 0.85);
        c = mix(c, lit, cl * 0.7);
    }
    if (uNight > 0.01) {
        vec2 sp = vec2(atan(d.y, d.x) * 260.0, d.z * 260.0), g = floor(sp), f = fract(sp) - 0.5;
        float st = step(0.993, hash12(g)) * smoothstep(0.22, 0.0, length(f)) * smoothstep(0.02, 0.3, d.z);
        c += vec3(st) * 0.8 * uNight;
    }
    return c;
}
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.08) * (0.3 + 0.7 * max(dot(n, l), 0.0));
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
    vec3 sky = skyGrad(vec3(d.xy, max(d.z, 0.0) * 0.35));
    c = mix(c, sky, smoothstep(300.0, 4500.0, dist) * 0.88);
    // valley mist: thicker where both the eye and the point are low
    float hAvg = max(vWorld.z, 0.0) * 0.75 + max(cPoint.z, 0.0) * 0.25;
    float m = uMist * (1.0 - exp(-dist * 0.0035)) * exp(-hAvg / 38.0);
    vec3 mc = mix(uSkyHor * 1.05, uSkyHor + uSunCol * 0.35, pow(max(dot(d, uSunDir), 0.0), 3.0));
    return mix(c, mc, clamp(m, 0.0, 0.92));
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyFull(d));
        gl_FragColor = vec4(o, smoothstep(0.88, 1.0, lum(o)) * 0.8); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.15, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { vec3 o = tone(fog(vCol * (0.25 + uNight * 0.9), dist)); gl_FragColor = vec4(o, uNight * 0.8); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 8.0) {
        vec2 q = vWorld.xy * 0.35 + vec2(0.0, uTime * 0.25);
        float e = 0.1, h0 = vnoise(q) + 0.5 * vnoise(q * 2.7 + uTime * 0.2);
        float hx = vnoise(q + vec2(e, 0.0)) + 0.5 * vnoise((q + vec2(e, 0.0)) * 2.7 + uTime * 0.2);
        float hy = vnoise(q + vec2(0.0, e)) + 0.5 * vnoise((q + vec2(0.0, e)) * 2.7 + uTime * 0.2);
        vec3 wn = normalize(vec3(-(hx - h0) / e * 0.04, -(hy - h0) / e * 0.04, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        vec3 c = mix(vCol * (uAmbTop * 0.6 + lights(wn) * 0.3), skyGrad(R), 0.3 + fres * 0.65);
        c += uSunCol * pow(max(dot(R, uSunDir), 0.0), 220.0) * 4.0 * (1.0 - uNight);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.6); return;
    }
    if (mat == 9.0) {                                            // balloon fabric
        float through = pow(max(dot(-V, uSunDir), 0.0), 4.0);
        vec3 c = shade(vCol, n, 0.5);
        c += vCol * uSunCol * through * 0.9 * (1.0 - uNight);                       // sun shining through
        c += vCol * vec3(1.0, 0.62, 0.3) * vW * 2.2;                               // burner glow inside
        c += uSkyGlow * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.25;                // rim
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, clamp(vW * 0.8 + through * 0.25, 0.0, 1.0) * smoothstep(0.4, 1.0, lum(o))); return;
    }
    if (mat == 10.0) {                                           // ground
        vec3 alb = vCol * (0.86 + 0.24 * vnoise(vWorld.xy * 0.08)) * (0.94 + 0.12 * vnoise(vWorld.xy * 0.9));
        if (vW > 0.5) {                                          // fields: rows / furrows, fade with distance
            float rows = 0.5 + 0.5 * sin((vWorld.x * 0.8 + vWorld.y * 0.6) * 1.9 + vnoise(floor(vWorld.xy / 55.0)) * 6.0);
            alb *= 1.0 - 0.18 * rows * (1.0 - smoothstep(150.0, 600.0, dist));
        }
        alb *= 0.93 + 0.07 * sin(vWorld.z * 0.9);                // strata on the slopes
        vec3 c = shade(alb, n, 0.15);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, 0.0); return;
    }
    if (mat == 11.0) {                                           // fairy chimneys
        float band = 0.9 + 0.1 * sin(vWorld.z * 1.4 + vnoise(vWorld.xy * 0.3) * 3.0);
        float streak = 0.9 + 0.12 * vnoise(vec2(atan(n.y, n.x) * 8.0, vWorld.z * 0.08));
        vec3 alb = vCol * band * streak;
        vec3 c = shade(alb, n, 0.2);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, 0.0); return;
    }
    if (mat == 12.0) {
        float snow = smoothstep(vW * 0.62, vW * 0.85, vWorld.z + vnoise(vWorld.xy * 0.004) * 120.0) * step(500.0, vW);
        vec3 alb = mix(vCol, vec3(0.95, 0.95, 1.0), snow);
        vec3 c = shade(alb, n, 0.4);
        vec3 d = normalize(vWorld - cPoint);
        c = mix(c, skyGrad(vec3(d.xy, 0.02)), clamp((1.0 - exp(-dist / 2600.0)) * 0.95, 0.0, 0.9));
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 2.0) {
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        vec3 alb = vCol * (0.8 + 0.35 * vnoise(vWorld.xy * 1.5 + vWorld.z));
        vec3 c = shade(alb, n, 0.7) + alb * uSunCol * back * 0.7 * (1.0 - uNight);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, 0.0); return;
    }
    if (mat == 1.0) {
        vec3 R = reflect(-V, n);
        vec3 c = shade(vCol * 0.5, n, 0.1) + skyGrad(R) * vCol * 0.7 + uSunCol * pow(max(dot(R, uSunDir), 0.0), 60.0) * (1.0 - uNight);
        vec3 o = tone(fog(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.5); return;
    }
    vec3 alb = vCol * (0.9 + 0.2 * vnoise(vWorld.xy * 3.0 + vWorld.z * 2.0));
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
    for (const n of ["aspect", "veriables", "uTime", "uSunDir", "uSunCol", "uSkyTop", "uSkyHor", "uSkyGlow", "uAmbTop", "uAmbBot", "uNight", "uMist", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
