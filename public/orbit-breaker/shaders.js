// Orbit Breaker scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// The arena is the z = 0 plane centred on the origin; the core's light (uCoreCol × uCoreK) and up to 7 more point
// lights (balls, bursts) light everything.
//
//   1 GLOSS  metal bricks, paddle shell     2 GEM  crystal bricks: Fresnel + inner glow (pos.w = glow)
//   3 BG     nebula + stars                 4 SPRITE · 5 EMIT · 7 ADD
//   8 FLOOR  dark glass disc with polar grid lines that ripple out from the core
//   9 CORE   plasma sphere: churning noise on the surface

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
uniform vec3 uCoreCol;
uniform float uCoreK;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.2), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 lights(vec3 n) {
    vec3 L = -vWorld + vec3(0.0, 0.0, 0.6); float d = length(L);
    vec3 acc = uCoreCol * uCoreK * 6.0 / (1.0 + d * d * 0.15) * (0.3 + 0.7 * max(dot(n, L / d), 0.0));
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 Li = uLights[i].xyz - vWorld; float di = length(Li);
        acc += uLightCol[i] * uLights[i].w / (1.0 + di * di * 0.8) * (0.3 + 0.7 * max(dot(n, Li / di), 0.0));
    }
    return acc;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec2 q = vec2(atan(d.x, d.y) * 1.4, d.z * 2.0) + uTime * 0.005;
        float n1 = fbm(q * 1.5), n2 = fbm(q * 3.0 + 4.0);
        vec3 c = vec3(0.005, 0.004, 0.015) + vec3(0.25, 0.08, 0.35) * pow(n1, 3.0) + vec3(0.05, 0.2, 0.35) * pow(n2, 4.0) * 1.2;
        vec2 sp = vec2(atan(d.x, d.y) * 260.0, d.z * 260.0), g = floor(sp), f = fract(sp) - 0.5;
        c += vec3(step(0.987, hash12(g)) * smoothstep(0.3, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash12(g) * 40.0)));
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.5, 1.0, lum(o)) * 0.5); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
    if (mat == 8.0) {                                                        // arena floor
        float r = length(vWorld.xy), a = atan(vWorld.y, vWorld.x);
        float rings = smoothstep(0.035, 0.0, abs(fract(r * 0.5) - 0.5) - 0.47);
        float spokes = smoothstep(0.02, 0.0, abs(fract(a / 6.2832 * 24.0) - 0.5) - 0.48) * smoothstep(1.2, 2.5, r);
        float wave = 0.5 + 0.5 * sin(r * 1.6 - uTime * 2.4);
        vec3 c = vec3(0.01, 0.01, 0.025) + vec3(0.25, 0.4, 0.9) * (rings * 0.25 + spokes * 0.12) * (0.4 + wave * 0.6) * smoothstep(10.5, 6.0, r);
        c += uCoreCol * uCoreK * 0.6 / (1.0 + r * r * 0.12);
        c += lights(vec3(0.0, 0.0, 1.0)) * 0.08;
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 9.0) {                                                        // plasma core
        vec3 n = normalize(vWorld - vec3(0.0, 0.0, 0.6));
        float pl = fbm(n.xy * 3.0 + vec2(uTime * 0.4, -uTime * 0.3) + n.z * 2.0);
        vec3 c = uCoreCol * (1.2 + pl * 2.2) * uCoreK + vec3(1.0) * pow(pl, 4.0) * 1.5 * uCoreK;
        float rim = pow(1.0 - abs(dot(n, V)), 2.0);
        c += uCoreCol * rim * 1.5;
        gl_FragColor = vec4(tone(c), 1.0); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {                                                        // crystal brick
        float f = pow(1.0 - abs(dot(n, V)), 2.2);
        vec3 R = reflect(-V, n);
        vec3 c = vCol * (0.12 + vW * 0.6) + vCol * f * 0.9 + lights(n) * vCol * 0.5 + vec3(1.0) * pow(max(dot(R, normalize(vec3(-0.3, -0.6, 0.8))), 0.0), 30.0) * 0.6;
        gl_FragColor = vec4(tone(c), clamp(0.3 + vW * 0.5, 0.0, 1.0)); return;
    }
    vec3 R = reflect(-V, n);
    vec3 c = vCol * (0.04 + lights(n) * 0.6) + vCol * pow(max(dot(R, normalize(vec3(-0.3, -0.6, 0.8))), 0.0), 20.0) * 0.8 + vec3(0.2, 0.25, 0.4) * pow(1.0 - abs(dot(n, V)), 3.0) * 0.4;
    gl_FragColor = vec4(tone(c), 0.1);
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
    for (const n of ["aspect", "veriables", "uTime", "uCoreCol", "uCoreK", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
