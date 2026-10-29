// Velvet Break scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables). col.a = material, pos.w = per-material data.
//
//   0 MATTE   lounge surfaces: lamp + dim fill
//   1 GLOSS   walnut, brass, leather: + specular
//   2 BALL    textured ball: col.rg = atlas uv, col.b = (nz ≥ 0) + 2·round(dim·50); pos.w = packed normal x/y
//   3 BG      backdrop
//   4 SPRITE  additive glow quad, pos.w = size + corner * 100
//   5 EMIT    emissive (lamp glass, bulbs)
//   6 SHADOW  multiply-blended soft shadow, pos.w = u * 2 + v, col.r = strength
//   7 ADD     additive (aim guide, rings)
//   8 FELT    cloth with nap noise
// The table lamp hangs above the centre: a cone light whose pool makes the table the brightest thing in the room.

export const NEAR = 0.3, FAR = 300.0;

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
varying vec3 vN;
varying float vDim;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vN = vec3(0.0, 0.0, 1.0); vDim = 1.0;
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
    } else if (mat == 2.0) {
        vUV = col.rg;
        float a = floor(pos.w / 1024.0), b = pos.w - a * 1024.0;
        float nx = a / 1023.0 * 2.0 - 1.0, ny = b / 1023.0 * 2.0 - 1.0;
        float s = mod(col.b, 2.0);
        vN = vec3(nx, ny, sqrt(max(0.0, 1.0 - nx * nx - ny * ny)) * (s > 0.5 ? 1.0 : -1.0));
        vDim = floor(col.b / 2.0) / 50.0;
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
varying vec3 vN;
varying float vDim;
uniform vec3 cPoint;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uAtlas;
uniform vec3 uLamp;          // lamp position
uniform vec4 uLights[4];
uniform vec3 uLightCol[4];
uniform float uLightCount;

const vec3 LAMPC = vec3(1.25, 1.05, 0.8);
vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.35); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }

// the lamp: a wide cone pointing down, plus a little room fill
float pool(vec3 p) {
    vec3 L = uLamp - p;
    float d = length(L);
    float cone = smoothstep(0.42, 0.9, L.z / d);
    return cone * 380.0 / (d * d + 60.0);
}
vec3 lightAt(vec3 alb, vec3 n, vec3 V, float gloss) {
    vec3 L = normalize(uLamp - vWorld);
    float pl = pool(vWorld);
    vec3 c = alb * (vec3(0.05, 0.05, 0.06) + LAMPC * pl * max(dot(n, L), 0.0));
    vec3 H = normalize(L + V);
    c += LAMPC * pl * pow(max(dot(n, H), 0.0), mix(16.0, 120.0, gloss)) * mix(0.03, 0.9, gloss);
    for (int i = 0; i < 4; i++) {
        if (float(i) >= uLightCount) break;
        vec3 Lp = uLights[i].xyz - vWorld; float d = length(Lp);
        c += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.08) * alb * max(dot(n, Lp / d) * 0.7 + 0.3, 0.0);
    }
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 p = vUV;
        vec3 c = mix(vec3(0.012, 0.016, 0.02), vec3(0.05, 0.035, 0.03), smoothstep(-1.0, 0.6, p.y));
        for (int i = 0; i < 10; i++) {
            float fi = float(i);
            vec2 o = vec2(fract(fi * 0.618) * 2.0 - 1.0, 0.25 + fract(fi * 0.381) * 0.7);
            float r = 0.04 + 0.04 * fract(fi * 0.77);
            float d = length((p - o) * vec2(uRes.x / uRes.y, 1.0));
            c += mix(vec3(1.0, 0.65, 0.3), vec3(0.4, 0.7, 0.6), fract(fi * 0.53)) * 0.045 * smoothstep(r, r - 0.012, d);
        }
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    vec3 V = normalize(cPoint - vWorld);
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.8); return; }
    if (mat == 6.0) {
        vec2 q = abs(vUV * 2.0 - 1.0);
        float r = length(q);
        gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.3, 1.0, r)) * vCol.r), 1.0); return;
    }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.8); return; }
    if (mat == 2.0) {
        vec3 n = normalize(vN);
        vec3 alb = texture2D(uAtlas, vUV).rgb; alb *= alb;
        vec3 c = lightAt(alb * vDim, n, V, 0.6);
        // clear-coat: the lamp's reflection and a soft rim
        vec3 R = reflect(-V, n);
        vec3 Ld = normalize(uLamp - vWorld);
        c += LAMPC * pow(max(dot(R, Ld), 0.0), 160.0) * 2.4 * pool(vWorld);
        c += vec3(0.08, 0.1, 0.1) * pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.7); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    vec3 alb = vCol;
    if (mat == 8.0) {
        float nap = noise(vWorld.xy * 9.0) * 0.5 + noise(vWorld.xy * 33.0) * 0.5;
        alb *= 0.88 + nap * 0.2;
        n = normalize(vec3(0.0, 0.0, 1.0) + vec3(noise(vWorld.xy * 40.0) - 0.5, noise(vWorld.yx * 40.0) - 0.5, 0.0) * 0.08);
    }
    vec3 c = lightAt(alb, n, V, mat == 1.0 ? 1.0 : 0.0);
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
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uAtlas", "uLamp", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
