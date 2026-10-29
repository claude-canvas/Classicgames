// Crystal Keep scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables) so the library's camera drives everything. col.a = material, pos.w = per-material data.
//
//   0 MATTE   sun key light + sky/bounce ambient + crystal point lights + golden haze
//   1 GLOSS   as MATTE with a sharp specular (crystal facets, armour, bronze)
//   2 WATER   animated river: wave normals, sky reflection, sun glint
//   3 BG      full-screen golden-hour sky with the sun
//   4 SPRITE  additive glow quad, pos.w = size + corner * 100
//   5 EMIT    emissive (crystals, eyes, embers, health bars)
//   6 SHADOW  multiply-blended soft contact shadow, pos.w = u * 2 + v, col.r = strength
//   7 ADD     additive geometry (range rings, trails, lightning, cell highlights)
// Alpha written = bloom mask (post.js). Space's xUnitVec points to screen-left, so screen x = -dot(v, xAxis).

export const NEAR = 0.5, FAR = 400.0;

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
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;
uniform vec3 uSunDir;

const vec3 SUN = vec3(1.55, 1.12, 0.72);
const vec3 SKY = vec3(0.42, 0.55, 0.78);
const vec3 HAZE = vec3(0.98, 0.72, 0.5);

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.35); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }

vec3 sky(vec3 d) {
    float h = d.z;
    vec3 c = mix(vec3(1.05, 0.66, 0.42), vec3(0.36, 0.5, 0.82), smoothstep(-0.02, 0.45, h));
    c = mix(c, vec3(0.17, 0.25, 0.52), smoothstep(0.4, 0.95, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += SUN * (pow(s, 1400.0) * 9.0 + pow(s, 60.0) * 0.45 + pow(s, 6.0) * 0.25);
    float band = smoothstep(0.06, 0.12, h) * (1.0 - smoothstep(0.12, 0.2, h)) * (0.5 + 0.5 * sin(d.x * 12.0 + d.y * 5.0));
    c = mix(c, vec3(1.25, 0.78, 0.62), band * 0.35);
    return c;
}

vec3 light(vec3 alb, vec3 n, vec3 V, float gloss) {
    float dk = max(dot(n, uSunDir), 0.0);
    vec3 c = alb * (SKY * 0.55 * (0.6 + 0.4 * n.z) + vec3(0.3, 0.2, 0.12) * (0.5 - 0.5 * n.z));
    c += alb * SUN * dk * 1.05;
    vec3 H = normalize(uSunDir + V);
    c += SUN * pow(max(dot(n, H), 0.0), mix(16.0, 80.0, gloss)) * mix(0.04, 0.7, gloss);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld;
        float d = length(L);
        float att = uLights[i].w / (1.0 + d * d * 0.18);
        c += uLightCol[i] * att * (alb * max(dot(n, L / d) * 0.8 + 0.2, 0.0) + pow(max(dot(reflect(-L / d, n), V), 0.0), 30.0) * gloss * 0.6);
    }
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 ndc = vUV;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(sky(d));
        gl_FragColor = vec4(o, smoothstep(0.88, 1.0, lum(o))); return;
    }
    vec3 toCam = cPoint - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-4);
    float haze = 1.0 - exp(-max(dist - 70.0, 0.0) * 0.008);

    if (mat == 4.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0);
        vec3 o = tone(vCol * k) * (1.0 - haze * 0.6);
        gl_FragColor = vec4(o, lum(o) * 1.5); return;
    }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 1.2); return; }
    if (mat == 6.0) {
        vec2 q = abs(vUV * 2.0 - 1.0);
        float r = length(max(q - 0.35, 0.0)) / 0.65;
        float k = (1.0 - smoothstep(0.0, 1.0, r)) * vCol.r;
        gl_FragColor = vec4(vec3(1.0 - k), 1.0); return;
    }
    if (mat == 5.0) { gl_FragColor = vec4(tone(mix(vCol, HAZE, haze * 0.5)), 0.8); return; }

    if (mat == 2.0) {
        vec2 q = vWorld.xy;
        vec3 n = normalize(vec3(
            0.07 * sin(q.x * 1.3 + uTime * 1.4) + 0.04 * sin(q.x * 2.9 - q.y * 1.7 + uTime * 2.1) + 0.03 * sin(q.y * 4.1 + uTime * 2.6),
            0.07 * cos(q.y * 1.1 - uTime * 1.2) + 0.04 * cos(q.y * 2.5 + q.x * 1.9 - uTime * 1.8) + 0.03 * cos(q.x * 3.7 - uTime * 2.3),
            1.0));
        vec3 R = reflect(-V, n);
        float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 body = vCol * (SKY * 0.35 + SUN * 0.25);
        vec3 c = mix(body, sky(vec3(R.xy, abs(R.z))) * 0.75, clamp(fres + 0.15, 0.0, 1.0));
        c += SUN * pow(max(dot(R, uSunDir), 0.0), 220.0) * 3.5;
        c = mix(c, HAZE, haze);
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.6); return;
    }

#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    vec3 c = light(vCol, n, V, mat == 1.0 ? 1.0 : 0.0);
    c = mix(c, HAZE, haze);
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
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uLights", "uLightCol", "uLightCount", "uSunDir"]) U[n] = loc(n);
    return U;
}
