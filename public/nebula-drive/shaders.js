// Nebula Drive scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// The highway runs along +y from the strike line (y = 0); uScroll is how far the road has travelled, so the
// road's grid scrolls while the geometry stays put.
//
//   2 GEM     faceted crystal: Fresnel rim + emissive core (vCol = lane colour)
//   3 BG      nebula: fbm clouds in the song palette (uPalA/B/C), stars, beat shimmer
//   4 SPRITE · 5 EMIT · 7 ADD (trails, rings, streaks, receptors)
//   8 ROAD    glassy road: lane dividers, scrolling grid, neon edges, beat pulse (pos.w = across, −2..2)
//   9 PLANET  banded gas giant lit by a distant star      10 ROCK  dark asteroid silhouettes

export const NEAR = 0.05, FAR = 4000.0;

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
uniform float uBeat;
uniform float uScroll;
uniform float uOD;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uLaneFlash;
uniform float uLaneFlash3;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.3); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.2), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 nebula(vec3 d) {
    vec2 q = vec2(atan(d.x, d.y) * 1.6, d.z * 2.2) + vec2(uTime * 0.01, 0.0);
    float n1 = fbm(q * 1.4), n2 = fbm(q * 2.6 + 5.0 + n1 * 1.5);
    vec3 c = vec3(0.004, 0.003, 0.012);
    c += uPalA * pow(n1, 3.0) * 0.9 + uPalB * pow(n2, 4.0) * 0.8 + uPalC * pow(n1 * n2, 2.0) * 0.6;
    c *= 0.8 + uBeat * 0.25;
    vec2 sp = vec2(atan(d.x, d.y) * 240.0, d.z * 240.0), g = floor(sp), f = fract(sp) - 0.5;
    float st = step(0.985, hash12(g)) * smoothstep(0.3, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * 3.0 + hash12(g) * 30.0));
    return c + vec3(st);
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(nebula(d));
        gl_FragColor = vec4(o, smoothstep(0.5, 1.0, lum(o)) * 0.5); return;
    }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
    if (mat == 8.0) {                                                         // road
        float u = vW, along = vWorld.y + uScroll;
        float lane = abs(fract(u + 0.5) - 0.5);                               // distance to the nearest divider (dividers at integer u)
        float div = smoothstep(0.03, 0.0, lane) * step(abs(u), 1.98);
        float edge = smoothstep(0.08, 0.0, abs(abs(u) - 2.05));
        float grid = smoothstep(0.035, 0.0, abs(fract(along / 4.0) - 0.5) - 0.465);
        float fade = 1.0 - smoothstep(40.0, 150.0, vWorld.y);
        vec3 base = vec3(0.012, 0.01, 0.03) + uPalC * 0.03;
        vec3 edgeC = mix(uPalA, vec3(1.0, 0.8, 0.3), uOD);
        vec3 c = base + edgeC * edge * (1.2 + uBeat * 1.2) + mix(uPalB, vec3(1.0, 0.85, 0.4), uOD) * div * 0.45 + uPalC * grid * 0.18 * (0.6 + uBeat);
        // lane flashes when keys are pressed
        float li = floor(u + 2.0);
        float fl = li < 0.5 ? uLaneFlash.x : li < 1.5 ? uLaneFlash.y : li < 2.5 ? uLaneFlash.z : uLaneFlash3;
        c += mix(uPalB, vec3(1.0), 0.4) * fl * 0.35 * smoothstep(12.0, 0.0, vWorld.y) * step(abs(u), 2.0);
        // a sheen reflecting the nebula
        c += (uPalA * 0.04 + uPalC * 0.05) * (0.6 + 0.4 * sin(along * 0.05)) * (1.0 - abs(u) * 0.2);
        c *= fade;
        gl_FragColor = vec4(tone(c), clamp(edge + div * 0.4 + fl * 0.3, 0.0, 1.0) * fade); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {                                                         // gem
        float f = pow(1.0 - abs(dot(n, V)), 2.0);
        vec3 c = vCol * (0.35 + 0.5 * f) + vec3(1.0) * pow(max(dot(reflect(-V, n), normalize(vec3(0.3, -0.5, 1.0))), 0.0), 24.0) * 0.8 + vCol * vW;
        gl_FragColor = vec4(tone(c), 0.7); return;
    }
    if (mat == 9.0) {                                                         // planet
        vec3 L = normalize(vec3(-0.6, 0.2, 0.5));
        float band = 0.5 + 0.5 * sin(vWorld.z * 0.05 + fbm(vWorld.xz * 0.004) * 6.0);
        vec3 alb = mix(vCol, vCol * 0.45 + uPalC * 0.2, band);
        vec3 c = alb * (max(dot(n, L), 0.0) * 1.1 + 0.03) + uPalA * pow(1.0 - abs(dot(n, V)), 3.0) * 0.5;
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    vec3 c = vCol * (0.12 + max(dot(n, normalize(vec3(-0.6, 0.2, 0.5))), 0.0) * 0.7) + uPalA * pow(1.0 - abs(dot(n, V)), 3.0) * 0.45 + uPalB * max(-n.z, 0.0) * 0.08;
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
    for (const n of ["aspect", "veriables", "uTime", "uBeat", "uScroll", "uOD", "uPalA", "uPalB", "uPalC", "uLaneFlash", "uLaneFlash3"]) U[n] = loc(n);
    return U;
}
