// Moonlake scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis, zAxis,
// veriables). col.a = material, pos.w = per-material data. All lighting follows the time-of-day uniforms.
//
//   0 MATTE   shores, wood, foliage · 1 GLOSS wet rock, lacquer · 2 WATER lake surface · 3 BG sky
//   4 SPRITE  additive glow quad (pos.w = size + corner·100) · 5 EMIT emissive · 6 SHADOW multiply (pos.w = u·2 + v)
//   7 ADD     additive geometry (line, ripples) · 8 FISH scales with sheen

export const NEAR = 0.1, FAR = 600.0;

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
varying vec3 vWorld;
varying vec2 vUV;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 6.0) {
        float u = step(1.5, pos.w);
        vUV = vec2(u, pos.w - 2.0 * u);
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
varying vec3 vWorld;
varying vec2 vUV;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uSun;       // sun direction
uniform vec3 uMoon;      // moon direction
uniform float uDay;      // 0..1 sun strength
uniform float uNight;    // 0..1 darkness (stars, moon)
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uSunCol;
uniform vec3 uFog;
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
uniform float uLightCount;

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.4); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 sky(vec3 d) {
    float h = d.z;
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.02, 0.6, h));
    float s = max(dot(d, uSun), 0.0);
    c += uSunCol * (pow(s, 900.0) * 7.0 * uDay + pow(s, 12.0) * 0.45 + pow(s, 3.0) * 0.12) * smoothstep(-0.15, 0.05, uSun.z);
    float m = max(dot(d, uMoon), 0.0);
    vec3 mc = vec3(0.85, 0.9, 1.05);
    float disc = smoothstep(0.9993, 0.9996, m);
    // a few soft craters on the moon
    vec2 mp = vec2(dot(d, normalize(cross(uMoon, vec3(0, 0, 1)))), d.z - uMoon.z) * 60.0;
    disc *= 0.85 + 0.15 * smoothstep(0.3, 0.7, hash(floor(mp * 2.0)));
    c += mc * (disc * 2.6 + pow(m, 80.0) * 0.4 + pow(m, 10.0) * 0.08) * uNight;
    // stars
    vec2 g = floor(vec2(atan(d.y, d.x) * 180.0, d.z * 260.0));
    float st = step(0.997, hash(g)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(g + 3.0) * 40.0));
    c += vec3(0.85, 0.9, 1.0) * st * uNight * smoothstep(0.02, 0.3, h) * 1.4;
    return c;
}

vec3 lit(vec3 alb, vec3 n, vec3 V, float gloss) {
    vec3 key = uSun.z > -0.05 ? uSun : uMoon;
    vec3 keyC = uSun.z > -0.05 ? uSunCol * (0.4 + 0.9 * uDay) : vec3(0.32, 0.4, 0.62) * uNight;
    vec3 amb = mix(uSkyHor, uSkyTop, 0.5) * 0.6 + vec3(0.02, 0.025, 0.04) + vec3(0.03, 0.045, 0.08) * uNight;
    vec3 c = alb * (amb * (0.6 + 0.4 * n.z) + keyC * max(dot(n, normalize(key)), 0.0));
    vec3 H = normalize(normalize(key) + V);
    c += keyC * pow(max(dot(n, H), 0.0), mix(12.0, 70.0, gloss)) * mix(0.03, 0.6, gloss);
    for (int i = 0; i < 6; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L);
        c += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.35) * (alb * max(dot(n, L / d) * 0.8 + 0.2, 0.0) + pow(max(dot(reflect(-L / d, n), V), 0.0), 30.0) * gloss);
    }
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 ndc = vUV;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(sky(d));
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o))); return;
    }
    vec3 toCam = cPoint - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-4);
    float fog = 1.0 - exp(-max(dist - 25.0, 0.0) * 0.012);
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k) * (1.0 - fog * 0.6); gl_FragColor = vec4(o, lum(o) * 1.5); return; }
    if (mat == 7.0) { vec3 o = tone(vCol) * (1.0 - fog * 0.5); gl_FragColor = vec4(o, lum(o)); return; }
    if (mat == 6.0) {
        vec2 q = abs(vUV * 2.0 - 1.0);
        float r = length(q * vec2(1.0, 1.0));
        gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.2, 1.0, r)) * vCol.r), 1.0); return;
    }
    if (mat == 5.0) { gl_FragColor = vec4(tone(mix(vCol, uFog, fog * 0.5)), 0.85); return; }
    if (mat == 2.0) {
        vec2 q = vWorld.xy;
        vec3 n = normalize(vec3(
            0.05 * sin(q.x * 0.9 + uTime * 0.8) + 0.035 * sin(q.x * 2.3 - q.y * 1.4 + uTime * 1.3) + 0.02 * sin(q.y * 4.7 + uTime * 2.1) + 0.012 * sin(q.x * 9.0 + q.y * 7.0 - uTime * 2.6),
            0.05 * cos(q.y * 0.7 - uTime * 0.7) + 0.035 * cos(q.y * 2.0 + q.x * 1.7 - uTime * 1.1) + 0.02 * cos(q.x * 5.1 - uTime * 1.9) + 0.012 * cos(q.y * 8.0 - q.x * 6.0 + uTime * 2.4),
            1.0));
        vec3 R = reflect(-V, n);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 body = vCol * (mix(uSkyHor, uSkyTop, 0.5) * 0.35 + 0.02);
        vec3 c = mix(body, sky(vec3(R.xy, abs(R.z))), clamp(fres * 1.1 + 0.08, 0.0, 1.0));
        for (int i = 0; i < 6; i++) {
            if (float(i) >= uLightCount) break;
            vec3 L = uLights[i].xyz - vWorld; float d = length(L);
            c += uLightCol[i] * uLights[i].w * (pow(max(dot(R, L / d), 0.0), 60.0) * 2.0 + 0.04 / (1.0 + d * d * 0.2));
        }
        c = mix(c, uFog, fog);
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.8, 1.0, lum(o)) * 0.7); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    vec3 c = lit(vCol, n, V, mat == 1.0 ? 0.8 : mat == 8.0 ? 0.9 : 0.0);
    if (mat == 8.0) c += sky(reflect(-V, n)) * 0.25 * pow(1.0 - max(dot(n, V), 0.0), 2.0) + vCol * 0.08;
    c = mix(c, uFog, fog);
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
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uSun", "uMoon", "uDay", "uNight", "uSkyTop", "uSkyHor", "uSunCol", "uFog", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
