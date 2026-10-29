// Jade Pavilion scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables) so the library's camera drives everything. col.a = material, pos.w = per-material data.
//
//   0 MATTE   room surfaces: ambient + key light + lantern point lights
//   1 GLOSS   tile slabs, lacquer: + sharp specular and fresnel sheen
//   2 FACE    tile face: col.rg = atlas uv, col.b = dim (+2 = hint pulse), pos.w = gold selection glow
//   3 BG      full-screen backdrop
//   4 SPRITE  additive glow quad, pos.w = size + corner * 100
//   5 EMIT    emissive (lantern paper, candle flames, gold sparks)
//   6 SHADOW  multiply-blended soft contact shadow, pos.w = u * 2 + v, col.r = strength
//   7 ADD     additive geometry (selection rims)
// Alpha written = bloom mask (see post.js). Space's xUnitVec points to screen-left, so screen x = -dot(v, xAxis).

export const NEAR = 0.3, FAR = 200.0;

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
varying float vW;

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
    } else if (mat == 6.0) {
        float u = step(1.5, pos.w);
        vUV = vec2(u, pos.w - 2.0 * u);
    } else if (mat == 2.0) {
        vUV = col.rg;
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
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uAtlas;
uniform vec4 uLights[6];        // xyz, strength
uniform vec3 uLightCol[6];
uniform float uLightCount;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uAmb;
uniform vec3 uBgTop;
uniform vec3 uBgBot;
uniform vec3 uFog;

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.45); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }

vec3 shade(vec3 alb, vec3 n, vec3 V, float gloss) {
    vec3 c = alb * uAmb * (0.75 + 0.25 * n.z);
    float dk = max(dot(n, uKeyDir), 0.0);
    c += alb * uKeyCol * dk;
    vec3 H = normalize(uKeyDir + V);
    c += uKeyCol * pow(max(dot(n, H), 0.0), mix(12.0, 90.0, gloss)) * mix(0.05, 0.55, gloss);
    for (int i = 0; i < 6; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld;
        float d = length(L);
        vec3 l = L / max(d, 1e-4);
        float att = uLights[i].w / (1.0 + d * d * 0.02);
        c += uLightCol[i] * att * (alb * max(dot(n, l), 0.0) + pow(max(dot(reflect(-l, n), V), 0.0), mix(10.0, 70.0, gloss)) * mix(0.03, 0.5, gloss));
    }
    c += uKeyCol * pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.18 * gloss;          // fresnel sheen on lacquer and jade
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        float t = vUV.y * 0.5 + 0.5;
        vec3 c = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, t));
        c *= 1.0 - 0.35 * dot(vUV * vec2(0.7, 1.0), vUV * vec2(0.7, 1.0));
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    vec3 toCam = cPoint - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-4);
    float fog = 1.0 - exp(-max(dist - 8.0, 0.0) * 0.022);

    if (mat == 4.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0);
        vec3 o = tone(vCol * k) * (1.0 - fog * 0.5);
        gl_FragColor = vec4(o, lum(o) * 1.6); return;
    }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 6.0) {
        vec2 q = abs(vUV * 2.0 - 1.0);
        float r = length(max(q - 0.55, 0.0)) / 0.45;
        float k = (1.0 - smoothstep(0.0, 1.0, r)) * vCol.r;
        gl_FragColor = vec4(vec3(1.0 - k), 1.0); return;
    }
    if (mat == 5.0) { gl_FragColor = vec4(tone(mix(vCol, uFog, fog * 0.6)), 0.8); return; }

#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;

    if (mat == 2.0) {
        vec3 alb = texture2D(uAtlas, vUV).rgb;
        alb = alb * alb;                                                        // sRGB-ish → linear
        float hint = step(1.5, vCol.b), dim = vCol.b - 2.0 * hint;
        vec3 c = shade(alb * 1.1, n, V, 0.55) * dim;
        float g = vW;
        c = mix(c, c * vec3(1.15, 1.0, 0.75) + vec3(0.35, 0.24, 0.06) * g, g);   // gold selection
        float hp = hint * (0.5 + 0.5 * sin(uTime * 6.0));
        c += vec3(0.08, 0.5, 0.32) * hp * 0.6;
        c = mix(c, uFog, fog);
        vec3 o = tone(c);
        gl_FragColor = vec4(o, g * 0.35 + hp * 0.3); return;
    }
    vec3 c = shade(vCol, n, V, mat == 1.0 ? 1.0 : 0.0);
    c = mix(c, uFog, fog);
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
    for (const n of ["aspect", "veriables", "uRes", "uTime", "uAtlas", "uLights", "uLightCol", "uLightCount", "uKeyDir", "uKeyCol", "uAmb", "uBgTop", "uBgBot", "uFog"]) U[n] = loc(n);
    return U;
}
