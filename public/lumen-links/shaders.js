// Lumen Links scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// Dusk: a low warm sky glow + cool moonlight, and up to 8 warm point lights (lanterns, fairy-light clusters,
// glowing mushrooms) that pool on the green.
//
//   0 MATTE  wood, posts      1 GLOSS  brass, lacquer     2 FOLIAGE  bushes, lily pads, island grass
//   3 BG     dusk sky: gradient, afterglow, stars, a crescent moon
//   4 SPRITE · 5 EMIT · 6 SHADOW · 7 ADD
//   8 WATER  ponds: reflections of the sky and lights     9 GREEN  putting green: mown stripes, fringe, dew
//  10 STONE  curbs (moss on top faces)  11 PAPER lanterns lit from inside (pos.w = glow)  12 BALL pearl

export const NEAR = 0.01, FAR = 2000.0;

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
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

const vec3 MOON = vec3(-0.45, 0.6, 0.66);
const vec3 MOONC = vec3(0.32, 0.36, 0.55);
const vec3 GLOWDIR = vec3(0.2, 1.0, 0.08);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.35); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.15), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 sky(vec3 d) {
    float h = d.z;
    vec3 c = mix(vec3(0.42, 0.24, 0.34), vec3(0.05, 0.06, 0.16), smoothstep(-0.02, 0.45, h));
    float g = max(dot(normalize(vec3(d.xy, 0.0)), normalize(GLOWDIR.xy).xyy * vec3(1.0, 1.0, 0.0)), 0.0);
    c += vec3(0.9, 0.42, 0.25) * pow(g, 6.0) * exp(-max(h, 0.0) * 7.0) * 0.8;
    c = mix(c, vec3(0.12, 0.08, 0.14), smoothstep(0.0, -0.3, h));
    if (h > 0.0) {
        vec2 sp = vec2(atan(d.y, d.x) * 240.0, h * 240.0), gg = floor(sp), f = fract(sp) - 0.5;
        c += vec3(step(0.991, hash12(gg)) * smoothstep(0.25, 0.0, length(f)) * smoothstep(0.1, 0.4, h) * (0.6 + 0.4 * sin(uTime * 2.0 + hash12(gg) * 30.0)));
        float m = dot(d, normalize(MOON)), m2 = dot(d, normalize(MOON + vec3(0.012, 0.0, 0.008)));
        c += vec3(1.0, 0.95, 0.8) * smoothstep(0.9994, 0.9997, m) * (1.0 - smoothstep(0.9994, 0.9997, m2)) * 2.5 + vec3(0.3, 0.3, 0.4) * pow(max(m, 0.0), 60.0) * 0.3;
    }
    return c;
}
vec3 lights(vec3 n) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 2.5) * (0.25 + 0.75 * max(dot(n, l), 0.0));
    }
    return acc;
}
vec3 shade(vec3 alb, vec3 n, float wrap) {
    float dl = max((dot(n, normalize(MOON)) + wrap) / (1.0 + wrap), 0.0);
    float gl = max(dot(n, normalize(GLOWDIR)) * 0.5 + 0.5, 0.0);
    return alb * (vec3(0.07, 0.07, 0.12) + MOONC * dl * 0.8 + vec3(0.32, 0.16, 0.12) * gl * 0.4 + lights(n));
}
vec3 fogc(vec3 c, float dist) { vec3 d = normalize(vWorld - cPoint); return mix(c, sky(vec3(d.xy, max(d.z, 0.0) * 0.4)), smoothstep(20.0, 300.0, dist) * 0.85); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(sky(d));
        gl_FragColor = vec4(o, smoothstep(0.7, 1.0, lum(o)) * 0.6); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.1, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 9.0) {                                                    // putting green
        vec2 p = vWorld.xy;
        float stripe = 0.5 + 0.5 * sign(sin(p.y * 3.4 + p.x * 0.4));
        vec3 alb = mix(vec3(0.16, 0.42, 0.14), vec3(0.2, 0.5, 0.17), stripe) * (0.88 + 0.2 * vnoise(p * 30.0)) * (0.92 + 0.12 * vnoise(p * 4.0));
        alb = mix(alb, vec3(0.12, 0.3, 0.1), vW);                         // fringe / rough
        vec3 c = shade(alb, n, 0.3);
        c += vec3(0.5, 0.6, 0.8) * step(0.997, hash12(floor(p * 140.0))) * pow(max(dot(reflect(-V, n), normalize(MOON)), 0.0), 4.0) * 0.6;   // dew
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.0); return;
    }
    if (mat == 8.0) {
        vec2 q = vWorld.xy * 3.0 + uTime * 0.3;
        vec3 wn = normalize(vec3((vnoise(q) - 0.5) * 0.15, (vnoise(q + 7.0) - 0.5) * 0.15, 1.0));
        vec3 R = reflect(-V, wn); R.z = abs(R.z);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
        vec3 c = vCol * 0.1 + sky(R) * (0.25 + fres * 0.7);
        for (int i = 0; i < 8; i++) { if (float(i) >= uLightCount) break; vec3 Ll = normalize(uLights[i].xyz - vWorld); c += uLightCol[i] * pow(max(dot(reflect(-Ll, wn), V), 0.0), 50.0) * uLights[i].w * 0.4; }
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.3); return;
    }
    if (mat == 11.0) {
        vec3 c = shade(vCol, n, 0.6) + vCol * vW * (1.0 + 0.1 * sin(uTime * 9.0 + vWorld.x * 7.0));
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.5, 1.0, lum(o)) * 0.9); return;
    }
    if (mat == 12.0) {
        vec3 R = reflect(-V, n);
        vec3 c = shade(vec3(0.95, 0.94, 0.92), n, 0.4) + sky(R) * 0.3 + lights(n) * pow(max(dot(R, vec3(0.0, 0.0, 1.0)), 0.0), 8.0) * 0.4 + vec3(0.25, 0.25, 0.3);
        gl_FragColor = vec4(tone(c), 0.45); return;
    }
    if (mat == 10.0) {
        vec3 alb = vCol * (0.78 + 0.35 * vnoise(vWorld.xy * 9.0 + vWorld.z * 7.0));
        alb = mix(alb, vec3(0.2, 0.36, 0.16), smoothstep(0.7, 0.95, n.z) * smoothstep(0.45, 0.75, vnoise(vWorld.xy * 6.0)) * 0.8);
        gl_FragColor = vec4(tone(fogc(shade(alb, n, 0.2), dist)), 0.0); return;
    }
    if (mat == 2.0) { vec3 alb = vCol * (0.8 + 0.4 * vnoise(vWorld.xy * 8.0 + vWorld.z * 5.0)); gl_FragColor = vec4(tone(fogc(shade(alb, n, 0.6), dist)), 0.0); return; }
    vec3 c = shade(vCol, n, 0.2);
    if (mat == 1.0) { vec3 R = reflect(-V, n); c += vCol * sky(R) * 0.6 + lights(n) * vCol * pow(max(dot(R, vec3(0.0, 0.0, 1.0)), 0.0), 6.0); }
    gl_FragColor = vec4(tone(fogc(c, dist)), 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
