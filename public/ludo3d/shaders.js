// Ludo 3D shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis, zAxis,
// veriables), so the library's camera drives everything. col.a = material.
//
//   0 LIT      flat-shaded surfaces (board frame, tiles, pedestals)
//   1 GLOSSY   pawns, the die, the home pyramid: sun highlight, soft reflection, rim light
//   2 GLOW     emissive
//   3 SKY      full-screen backdrop: warm evening gradient with drifting bokeh lights
//   4 WOOD     the table: procedural walnut grain
//   5 SPRITE   additive glow; pos.w = size + corner * 100, camera-facing
//   6 BOARD    the board's cream surface: fine paper/felt texture
//   8 SHADOW   soft dark blob lying flat; pos.w = size + corner * 100
// uShift moves the picture on screen (keeps the board clear of the HUD).
// Space's xUnitVec points to screen-left, so screen x uses -dot(v, xAxis).

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec2 uShift;

varying vec3 vCol;
varying float vMat;
varying vec3 vWorld;
varying vec2 vUV;

void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = vec3(0.0); return; }
    vec3 p = pos.xyz;
    if (mat == 5.0 || mat == 8.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        if (mat == 8.0) p += vec3(c * size, 0.0);
        else p += (-xAxis * c.x + yAxis * c.y) * size;
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float NEAR = 0.1, FAR = 400.0;
    gl_Position = vec4(xp * k + uShift.x * zp, yp * k * aspect + uShift.y * zp, zp * (FAR + NEAR) / (FAR - NEAR) - 2.0 * FAR * NEAR / (FAR - NEAR), zp);
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
uniform vec2 uShift;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uLight;
uniform vec3 uFlash;       // rgb flash (a capture tints the screen with the attacker's colour)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
const vec3 SUN = vec3(1.0, 0.9, 0.78);
const vec3 AMB = vec3(0.42, 0.4, 0.46);
const vec3 ROOM = vec3(0.32, 0.2, 0.16);     // what reflections see: a warm room

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.45); }
vec3 finish(vec3 c) {
    c = tone(c);
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.15);
    return clamp(c + uFlash, 0.0, 1.0);
}

void main() {
    float mat = floor(vMat + 0.5);
    vec3 V = normalize(cPoint - vWorld);
#ifdef GL_OES_standard_derivatives
    vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 fn = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(fn, V) < 0.0) fn = -fn;

    if (mat == 3.0) {                                                 // evening backdrop with bokeh
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c = mix(vec3(0.42, 0.22, 0.16), vec3(0.08, 0.06, 0.12), smoothstep(0.0, 1.0, uv.y));
        vec2 p = gl_FragCoord.xy / uRes.y * 7.0;
        for (int i = 0; i < 3; i++) {
            float s = 1.0 + float(i) * 0.7;
            vec2 q = p * s + vec2(uTime * 0.03 * s, float(i) * 13.0);
            vec2 cell = floor(q), f = fract(q) - 0.5;
            float h = hash(cell + float(i) * 7.0);
            vec2 o = vec2(hash(cell + 3.1), hash(cell + 5.7)) - 0.5;
            float d = length(f - o * 0.6);
            float r = 0.12 + h * 0.18;
            float b = smoothstep(r, r * 0.75, d) * step(0.55, h) * (0.6 + 0.4 * sin(uTime * 0.7 + h * 30.0));
            vec3 bc = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.55), hash(cell + 9.0));
            c += bc * b * (0.22 / s);
        }
        gl_FragColor = vec4(finish(c), 1.0); return;
    }
    if (mat == 5.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.05, 0.0);
        gl_FragColor = vec4(vCol * k, 1.0); return;
    }
    if (mat == 8.0) {
        float a = smoothstep(1.0, 0.1, length(vUV)) * vCol.r;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
    }
    if (mat == 2.0) { gl_FragColor = vec4(finish(vCol), 1.0); return; }

    vec3 L = normalize(uLight);
    float diff = max(dot(fn, L), 0.0);
    vec3 amb = AMB * (0.6 + 0.4 * fn.z);
    vec3 c;
    if (mat == 1.0) {
        vec3 R = reflect(-V, fn);
        float fres = 0.05 + 0.95 * pow(1.0 - max(dot(fn, V), 0.0), 5.0);
        c = vCol * (amb + SUN * diff * 0.95);
        vec3 env = mix(ROOM, vec3(1.0, 0.85, 0.65), smoothstep(-0.1, 0.8, R.z));
        c = mix(c, env, fres * 0.4);
        c += SUN * pow(max(dot(R, L), 0.0), 70.0) * 1.1;
        c += vec3(1.0, 0.7, 0.45) * pow(1.0 - max(dot(fn, V), 0.0), 3.0) * 0.18;
    } else if (mat == 4.0) {                                          // walnut table
        vec2 q = vWorld.xy;
        float grain = sin((q.y + noise(q * vec2(0.15, 0.6)) * 3.0) * 7.0) * 0.5 + 0.5;
        float fine = noise(q * vec2(0.6, 9.0));
        vec3 w = mix(vec3(0.3, 0.16, 0.08), vec3(0.46, 0.26, 0.13), grain * 0.7 + fine * 0.3);
        float plank = step(0.97, fract(q.x / 6.0));
        w *= 1.0 - plank * 0.25;
        c = w * (amb + SUN * diff);
        vec3 R = reflect(-V, vec3(0.0, 0.0, 1.0));
        c += SUN * pow(max(dot(R, L), 0.0), 24.0) * 0.18;
        float dist = length(vWorld.xy);
        c *= smoothstep(48.0, 16.0, dist) * 0.85 + 0.15;              // the table fades into the dark room
    } else if (mat == 6.0) {                                          // board surface
        float n = noise(vWorld.xy * 6.0) * 0.5 + noise(vWorld.xy * 23.0) * 0.5;
        c = vCol * (0.94 + 0.08 * n) * (amb + SUN * diff);
    } else {
        c = vCol * (amb + SUN * diff);
        c += vCol * 0.12 * pow(1.0 - max(dot(fn, V), 0.0), 3.0);
    }
    gl_FragColor = vec4(finish(c), 1.0);
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
    const U = {};
    for (const n of ["aspect", "veriables", "uShift", "uRes", "uTime", "uLight", "uFlash"]) U[n] = loc(n);
    return U;
}
