// Tideglow scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables), so the library's camera drives everything. col.a = material, pos.w = per-material data.
//
//   0 ROCK     flat-shaded solid: sun from above fading with depth, caustics near the surface, coloured point
//              lights (light 0 is the jellyfish), depth fog. Above the water it is lit by the sunset instead.
//   1 EMIT     emissive (glowing coral tips, lures, vent cracks, eyes)
//   2 BG       full-screen background: water gradient + Snell's window underwater, sunset sky above
//   3 SPRITE   additive soft glow quad, pos.w = size + corner * 100
//   4 JELLY    additive fresnel-rim translucent bell, pos.w = latitude (0 top .. 1 rim)
//   5 SHAFT    additive god ray, pos.w = u * 2 + v
//   6 KELP     like ROCK, swayed in the vertex shader by pos.w
//   7 SURFACE  the sea surface (from below: Snell's window + total internal reflection; from above: sunset sea)
//   8 ADD      plain additive geometry (tentacles, streaks)
// Space's xUnitVec points to screen-left, so screen x uses -dot(v, xAxis).

export const NEAR = 0.5, FAR = 420.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;

varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;
varying float vW;

void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vW = pos.w;
    if (mat == 2.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; return; }
    vec3 p = pos.xyz;
    if (mat == 3.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p += (-xAxis * c.x + yAxis * c.y) * size;
    } else if (mat == 5.0) {
        float u = step(1.5, pos.w);
        vUV = vec2(u, pos.w - 2.0 * u);
    } else if (mat == 6.0) {
        float w = pos.w;
        p.x += sin(uTime * 1.1 + p.z * 0.33 + p.y * 0.7) * w * 0.7;
        p.y += cos(uTime * 0.83 + p.z * 0.27 + p.x * 0.3) * w * 0.35;
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
varying float vW;

uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uLights[8];        // xyz, strength
uniform vec3 uLightCol[8];
uniform float uLightCount;

const vec3 SUN_DIR = vec3(0.2357, 0.9428, 0.2357);   // low evening sun, ahead of the camera
const vec3 SUN = vec3(1.0, 0.62, 0.32);

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.5); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// the colour of open water at height z (0 = surface, -480 = sea floor)
vec3 waterCol(float z) {
    float t = clamp(-z / 480.0, 0.0, 1.0) * 4.0;
    vec3 c0 = vec3(0.11, 0.66, 0.70), c1 = vec3(0.035, 0.32, 0.50), c2 = vec3(0.014, 0.11, 0.28);
    vec3 c3 = vec3(0.012, 0.028, 0.11), c4 = vec3(0.010, 0.004, 0.032);
    vec3 c = mix(c0, c1, clamp(t, 0.0, 1.0));
    c = mix(c, c2, clamp(t - 1.0, 0.0, 1.0));
    c = mix(c, c3, clamp(t - 2.0, 0.0, 1.0));
    c = mix(c, c4, clamp(t - 3.0, 0.0, 1.0));
    return c;
}
float sunAt(float z) { return exp(min(z, 0.0) / 110.0); }
float fogDensity(float z) { return mix(0.0105, 0.017, clamp(-z / 300.0, 0.0, 1.0)); }

vec3 sky(vec3 d) {
    float h = d.z;
    vec3 c = mix(vec3(1.25, 0.55, 0.32), vec3(0.32, 0.22, 0.48), smoothstep(0.0, 0.35, h));
    c = mix(c, vec3(0.07, 0.08, 0.24), smoothstep(0.3, 0.9, h));
    float sd = max(dot(d, SUN_DIR), 0.0);
    c += SUN * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.55 + pow(sd, 6.0) * 0.18);
    // a few soft cloud streaks
    float cl = smoothstep(0.55, 0.9, sin(d.x * 9.0 + sin(d.y * 4.0)) * 0.5 + 0.5) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.2, 0.35, h));
    c = mix(c, vec3(1.1, 0.5, 0.45), cl * 0.35);
    return c;
}

float caustic(vec2 p, float t) {
    vec2 q = p * 0.42;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        q += vec2(sin(q.y * 1.3 + t * 0.7 + fi), cos(q.x * 1.1 - t * 0.55 + fi * 1.7)) * 0.55;
    }
    float v = abs(sin(q.x * 1.6) * cos(q.y * 1.6));
    return pow(1.0 - v, 9.0);
}

void main() {
    float mat = floor(vMat + 0.5);
    vec3 toCam = cPoint - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-4);
    bool under = cPoint.z < 0.0;

    // ---------------------------------------------------------------- background
    if (mat == 2.0) {
        vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 c;
        if (under) {
            c = waterCol(cPoint.z + d.z * 70.0) * (0.85 + 0.25 * max(d.z, 0.0));
            float s = sunAt(cPoint.z);
            // Snell's window: the bright sky disc straight above, wobbling with the waves
            float up = d.z + 0.02 * sin(d.x * 30.0 + uTime * 1.3) * sin(d.y * 24.0 - uTime);
            c += vec3(0.75, 0.9, 0.8) * smoothstep(0.62, 0.8, up) * s * 1.4;
            // background rays
            float ang = atan(d.x, d.y);
            float rays = pow(0.5 + 0.5 * sin(ang * 23.0 + uTime * 0.25) * sin(ang * 11.0 - uTime * 0.17), 3.0);
            c += vec3(0.25, 0.45, 0.42) * rays * smoothstep(-0.1, 0.6, d.z) * s * 0.55;
        } else {
            c = d.z > 0.0 ? sky(d) : mix(vec3(0.09, 0.12, 0.2), sky(vec3(d.xy, -d.z)) * 0.5, 0.6);
        }
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.8, 0.98, max(o.r, max(o.g, o.b)))); return;
    }

    // fog shared by everything
    float fogZ = mix(vWorld.z, cPoint.z, 0.5);
    vec3 fogC = under ? waterCol(fogZ) : mix(vec3(0.75, 0.42, 0.38), vec3(0.3, 0.22, 0.4), 0.3);
    float dens = under ? fogDensity(cPoint.z) : 0.006;
    float fog = 1.0 - exp(-dist * dens);

    // ---------------------------------------------------------------- additive materials
    if (mat == 3.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0);
        vec3 o = tone(vCol * k) * (1.0 - fog);
        gl_FragColor = vec4(o, max(o.r, max(o.g, o.b)) * 2.0); return;
    }
    if (mat == 8.0) { vec3 o = tone(vCol) * (1.0 - fog); gl_FragColor = vec4(o, max(o.r, max(o.g, o.b)) * 1.5); return; }
    if (mat == 5.0) {
        float e = sin(vUV.x * 3.14159);
        float flick = 0.75 + 0.25 * sin(uTime * 0.6 + vWorld.x * 0.7) * sin(uTime * 0.37 + vWorld.y);
        float k = e * e * pow(1.0 - clamp(vUV.y, 0.0, 1.0), 1.6) * flick;
        vec3 o = tone(vCol * k) * (1.0 - fog * 0.7);
        gl_FragColor = vec4(o, max(o.r, max(o.g, o.b)) * 0.6); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 fn = vec3(0.0, -1.0, 0.0);
#endif
    if (dot(fn, V) < 0.0) fn = -fn;
    if (mat == 4.0) {
        float facing = abs(dot(fn, V));
        float rim = pow(1.0 - facing, 1.7);
        vec3 c = vCol * (0.035 + rim * 0.95 + (1.0 - vW) * 0.06);
        vec3 o = tone(c) * (1.0 - fog);
        gl_FragColor = vec4(o, max(o.r, max(o.g, o.b)) * 1.6); return;
    }

    // ---------------------------------------------------------------- emissive
    if (mat == 1.0) { gl_FragColor = vec4(tone(mix(vCol, fogC, fog * 0.85)), 0.55 * (1.0 - fog)); return; }

    // ---------------------------------------------------------------- the sea surface
    if (mat == 7.0) {
        vec2 q = vWorld.xy * 2.2;
        vec3 n = normalize(vec3(
            0.09 * sin(q.x * 0.9 + uTime * 1.2) + 0.05 * sin(q.x * 2.3 - q.y * 1.1 + uTime * 1.9) + 0.03 * sin(q.y * 3.1 + uTime * 2.4),
            0.09 * cos(q.y * 0.8 - uTime * 1.0) + 0.05 * cos(q.y * 2.1 + q.x * 1.3 - uTime * 1.6) + 0.03 * cos(q.x * 3.7 - uTime * 2.2),
            1.0));
        vec3 c;
        if (under) {
            float cosT = abs(dot(n, V));
            float win = smoothstep(0.58, 0.72, cosT);
            vec3 refr = sky(normalize(vec3(-V.xy * 1.3, 0.4))) * 0.9 + vec3(0.2, 0.4, 0.35);
            vec3 tir = waterCol(-8.0) * 0.8;
            c = mix(tir, refr, win);
            c += vec3(1.0, 0.8, 0.5) * pow(max(dot(-V, normalize(vec3(0.0, 0.2, 1.0) + n * 0.6)), 0.0), 60.0) * 0.8;
        } else {
            vec3 R = reflect(-V, n);
            float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            vec3 deep = vec3(0.02, 0.1, 0.16);
            c = mix(deep, sky(vec3(R.xy, abs(R.z))), clamp(fres + 0.12, 0.0, 1.0));
            c += SUN * pow(max(dot(R, SUN_DIR), 0.0), 300.0) * 5.0;
        }
        c = mix(c, fogC, fog * (under ? 1.0 : 0.6));
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, max(o.r, max(o.g, o.b)))); return;
    }

    // ---------------------------------------------------------------- solids (rock, coral, kelp, creatures)
    vec3 alb = vCol;
    vec3 c;
    if (vWorld.z > 0.15) {
        // above the water: warm sunset key light, purple sky fill
        float dif = max(dot(fn, SUN_DIR), 0.0);
        c = alb * (vec3(0.16, 0.12, 0.24) + vec3(0.25, 0.15, 0.2) * max(fn.z, 0.0) + SUN * dif * 1.5);
    } else {
        float s = sunAt(vWorld.z);
        vec3 wc = waterCol(vWorld.z);
        c = alb * (wc * 0.9 + vec3(0.006, 0.008, 0.02));
        float up = max(fn.z, 0.0);
        c += alb * vec3(0.7, 0.92, 0.88) * s * (0.3 + up * 0.8);
        float ca = caustic(vWorld.xy + vWorld.z * 0.35, uTime) + caustic(vWorld.xy * 1.37 + 3.1 + vWorld.z * 0.2, uTime * 1.13) * 0.6;
        c += alb * vec3(0.9, 1.0, 0.85) * ca * s * (0.3 + up) * 1.1;
        if (mat == 6.0) c += alb * vec3(0.4, 0.6, 0.2) * s * 0.4;             // light through the kelp blades
    }
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld;
        float d = length(L);
        vec3 l = L / max(d, 1e-4);
        float att = uLights[i].w / (1.0 + d * d * 0.045);
        float dif = max(dot(fn, l) * 0.75 + 0.25, 0.0);
        float spec = pow(max(dot(reflect(-l, fn), V), 0.0), 18.0) * 0.45;
        c += uLightCol[i] * att * (alb * dif * 1.6 + spec);
    }
    c += waterCol(vWorld.z) * pow(1.0 - max(dot(fn, V), 0.0), 3.0) * 0.18;     // a little rim from the water
    c = mix(c, fogC, fog);
    gl_FragColor = vec4(tone(c), 0.0);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos");
    gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, {
        program,
        cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"),
        xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"),
        varsLocation: loc("veriables"),
    });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
