// Neon Strike scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// Lane frame: x across, y down the lane, z up (lane surface z = 0). The alley is lit by up to 8 coloured point
// lights (neon tubes, the pin-deck spot) plus a dim ambient.
//
//   0 MATTE   walls, capping, masking unit       1 GLOSS  ball returns, metal
//   2 PIN     glossy white pins (vCol carries the red neck stripes)
//   3 BG      dark alley ceiling haze (nothing much: everything is enclosed)
//   4 SPRITE  additive glow · 5 EMIT emissive neon tube · 6 SHADOW multiply · 7 ADD additive
//   8 LANE    maple boards, arrows/dots, oil sheen; blended over the mirrored pins/ball (alpha = 1 − reflectivity)
//             pos.w: 1 = lane boards, 2 = approach (darker, wider boards), 3 = pin deck
//   9 BALL    urethane swirl (vertex colours) + clear-coat
//  10 FLOOR   carpet / dark floor with black-light speckle   11 GRID  retro grid wall (lines glow)

export const NEAR = 0.02, FAR = 400.0;

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
uniform float uPulse;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

const vec3 AMB = vec3(0.05, 0.035, 0.08);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.2), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// diffuse + specular from the point lights
vec3 lit(vec3 alb, vec3 n, vec3 V, float spec, float shin) {
    vec3 acc = AMB * (0.6 + 0.4 * n.z), sp = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L); vec3 l = L / d;
        vec3 c = uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.12);
        acc += c * max(dot(n, l), 0.0);
        sp += c * pow(max(dot(reflect(-l, n), V), 0.0), shin);
    }
    return alb * acc + sp * spec;
}
float arrows(vec2 p) {
    // seven arrows at ~4.6 m and the guide dots at ~2.1 m, centred on boards 5, 10, 15, 20 (from each side)
    float bw = 1.054 / 39.0, m = 0.0;
    for (int i = 0; i < 7; i++) {
        float bx = (float(i) - 3.0) * 5.0 * bw, by = 4.57 + abs(float(i) - 3.0) * 0.3;
        vec2 q = p - vec2(bx, by);
        if (q.y > -0.03 && q.y < 0.17 && abs(q.x) < (0.17 - q.y) * 0.18) m = 1.0;
        if (length((p - vec2(bx, 2.13)) * vec2(1.0, 1.0)) < 0.011) m = 1.0;
    }
    return m;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { gl_FragColor = vec4(0.01, 0.006, 0.02, 0.0); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.1, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { vec3 o = tone(vCol * (1.0 + uPulse * 0.4)); gl_FragColor = vec4(o, 0.95); return; }
    if (mat == 8.0) {                                                        // lane boards
        vec2 p = vWorld.xy; float kind = floor(vW + 0.5);
        float bw = kind > 1.5 && kind < 2.5 ? 0.08 : 1.054 / 39.0;
        float board = floor((p.x + 5.0) / bw), bv = hash12(vec2(board, kind));
        float grain = vnoise(vec2(p.x * 260.0, p.y * 3.0 + board * 7.0)) * 0.5 + vnoise(vec2(p.x * 900.0, p.y * 12.0)) * 0.25;
        vec3 alb = vCol * (0.82 + 0.22 * bv) * (0.85 + 0.25 * grain);
        float seam = smoothstep(0.0, 0.06, abs(fract((p.x + 5.0) / bw) - 0.5) * 2.0 - 0.9);
        alb *= 1.0 - seam * 0.3;
        if (kind < 1.5) { float a = arrows(p); alb = mix(alb, vec3(0.06, 0.03, 0.12), a * 0.85); }
        if (kind > 2.5) alb *= 0.92;
        vec3 n = vec3(0.0, 0.0, 1.0);
        vec3 c = lit(alb, n, V, kind < 1.5 ? 0.9 : 0.5, 220.0);
        // reflectivity: Fresnel, wetter on the oil
        float fres = 0.12 + 0.88 * pow(1.0 - max(V.z, 0.0), 4.0);
        float oil = kind < 1.5 ? 1.0 - smoothstep(10.0, 13.5, p.y) * 0.55 : 0.5;
        float refl = clamp(fres * (0.55 + 0.4 * oil), 0.0, 0.92);
        vec3 o = tone(c);
        gl_FragColor = vec4(o, 1.0 - refl); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {                                                        // pins
        vec3 c = lit(vCol, n, V, 0.8, 60.0);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        c += vec3(0.6, 0.3, 1.0) * rim * 0.25 + vCol * 0.05;
        gl_FragColor = vec4(tone(c), smoothstep(0.75, 1.0, lum(tone(c))) * 0.4); return;
    }
    if (mat == 9.0) {                                                        // ball
        vec3 c = lit(vCol, n, V, 1.4, 90.0);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 2.5);
        c += vec3(0.4, 0.2, 0.8) * rim * 0.4;
        gl_FragColor = vec4(tone(c), 0.2); return;
    }
    if (mat == 10.0) {
        float sp = step(0.985, hash12(floor(vWorld.xy * 60.0)));
        vec3 alb = vCol * (0.8 + 0.2 * vnoise(vWorld.xy * 8.0));
        vec3 c = lit(alb, n, V, 0.1, 20.0) + vec3(0.3, 0.6, 1.0) * sp * 0.25 + vec3(1.0, 0.3, 0.8) * step(0.993, hash12(floor(vWorld.xy * 45.0) + 3.0)) * 0.25;
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 11.0) {                                                       // retro grid wall
        vec2 g = abs(fract(vec2(vWorld.y * 0.5, vWorld.z * 1.5)) - 0.5);
        float line = smoothstep(0.47, 0.5, max(g.x, g.y));
        vec3 c = vCol * 0.05 + vCol * line * (0.7 + 0.3 * sin(uTime * 2.0 + vWorld.y)) * (0.6 + uPulse);
        gl_FragColor = vec4(tone(c), line * 0.6); return;
    }
    float spec = mat == 1.0 ? 0.8 : 0.15;
    vec3 c = lit(vCol, n, V, spec, mat == 1.0 ? 50.0 : 12.0);
    gl_FragColor = vec4(tone(c), 0.0);
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
    for (const n of ["aspect", "veriables", "uTime", "uPulse", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
