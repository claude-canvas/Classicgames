// Gemfall scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables) so the library's camera drives everything. col.a = material, pos.w = per-material data.
//
//   0 MATTE   velvet, wood, felt: key light + warm fill + point lights
//   1 GLOSS   lacquer, gold, glass: + sharp specular
//   2 GEM     faceted jewel: studio-softbox reflections, inner glow, fresnel, white glints (these bloom)
//   3 BG      full-screen atelier backdrop with soft bokeh
//   4 SPRITE  additive glow quad, pos.w = size + corner * 100
//   5 EMIT    emissive
//   6 SHADOW  multiply-blended contact shadow, pos.w = u * 2 + v, col.r = strength
//   7 ADD     additive geometry (beams, rings, selection)
//   8 ICE     additive frost overlay, col = tint, pos.w = layers
// Alpha written = bloom mask (post.js).

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
uniform vec4 uLights[6];
uniform vec3 uLightCol[6];
uniform float uLightCount;

const vec3 KEY = normalize(vec3(-0.35, -0.45, 0.82));
const vec3 KEYC = vec3(1.0, 0.92, 0.85);

vec3 tone(vec3 c) { return vec3(1.0) - exp(-c * 1.4); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// a photographer's studio: two big softboxes, a strip light and a dark room
vec3 studio(vec3 d) {
    vec3 c = vec3(0.03, 0.02, 0.05) + vec3(0.12, 0.08, 0.16) * max(d.z, 0.0);
    c += vec3(1.6, 1.5, 1.4) * smoothstep(0.82, 0.9, dot(d, normalize(vec3(-0.5, -0.4, 0.75))));
    c += vec3(1.1, 1.15, 1.3) * smoothstep(0.86, 0.93, dot(d, normalize(vec3(0.6, 0.2, 0.75))));
    c += vec3(0.9, 0.75, 0.55) * smoothstep(0.96, 1.0, 1.0 - abs(d.x - 0.1)) * smoothstep(0.2, 0.5, d.z);
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 p = vUV;
        vec3 c = mix(vec3(0.05, 0.03, 0.08), vec3(0.16, 0.07, 0.17), smoothstep(-1.2, 1.0, p.y));
        c *= 1.0 - 0.45 * dot(p * vec2(0.6, 0.8), p * vec2(0.6, 0.8));
        // drifting bokeh
        for (int i = 0; i < 9; i++) {
            float fi = float(i);
            vec2 o = vec2(sin(fi * 2.1 + uTime * 0.05) * 0.9, cos(fi * 1.3 + uTime * 0.04) * 0.75);
            float r = 0.07 + 0.05 * fract(fi * 0.37);
            float d = length((p - o) * vec2(uRes.x / uRes.y, 1.0));
            c += mix(vec3(0.9, 0.6, 0.3), vec3(0.5, 0.4, 1.0), fract(fi * 0.61)) * 0.05 * smoothstep(r, r - 0.015, d);
        }
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    vec3 toCam = cPoint - vWorld;
    vec3 V = normalize(toCam);
    if (mat == 4.0) {
        float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0);
        vec3 o = tone(vCol * k);
        gl_FragColor = vec4(o, lum(o) * 1.5); return;
    }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 1.3); return; }
    if (mat == 6.0) {
        vec2 q = abs(vUV * 2.0 - 1.0);
        float r = length(max(q - 0.4, 0.0)) / 0.6;
        gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.0, 1.0, r)) * vCol.r), 1.0); return;
    }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.8); return; }
    if (mat == 8.0) {
        // frost: crystalline noise, brighter with more layers
        vec2 g = vWorld.xy * 3.0;
        float n = hash(floor(g)) * 0.5 + hash(floor(g * 2.3 + 7.0)) * 0.5;
        float cr = smoothstep(0.92, 0.98, abs(sin(vWorld.x * 9.0 + sin(vWorld.y * 7.0) * 2.0)));
        vec3 o = vCol * (0.35 + n * 0.3 + cr * 0.5) * (0.6 + 0.4 * vW);
        gl_FragColor = vec4(tone(o), lum(o) * 0.4); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 2.0) {
        vec3 R = reflect(-V, n);
        // the studio turns slowly so sparkles travel across the facets
        float ca = cos(uTime * 0.35), sa = sin(uTime * 0.35);
        vec3 Rr = vec3(R.x * ca - R.y * sa, R.x * sa + R.y * ca, R.z);
        float fres = 0.18 + 0.82 * pow(1.0 - max(dot(n, V), 0.0), 2.5);
        vec3 env = studio(Rr) * 1.35;
        float facet = hash(floor(n.xy * 9.0) + floor(n.z * 7.0));               // each facet catches light differently ("fire")
        vec3 body = vCol * (0.1 + 0.42 * max(dot(n, KEY), 0.0)) * (0.7 + 0.6 * facet);
        // light that "enters" and comes back out tinted: brighter on facets facing away from the key
        body += vCol * vCol * 0.55 * pow(max(dot(-n, normalize(vec3(0.2, 0.3, -1.0))), 0.0), 1.5);
        vec3 c = body + env * mix(vCol * 0.9 + 0.1, vec3(1.0), 0.35) * fres * 1.2;
        float glint = pow(max(dot(Rr, normalize(vec3(-0.5, -0.4, 0.75))), 0.0), 160.0) + pow(max(dot(Rr, normalize(vec3(0.6, 0.2, 0.75))), 0.0), 220.0);
        c += mix(vec3(1.6), vCol * 2.0 + 0.4, 0.35) * glint * 2.6;
        c += vCol * smoothstep(0.93, 1.0, facet) * (0.6 + 0.6 * sin(uTime * 3.0 + facet * 40.0)) * 0.9;
        for (int i = 0; i < 6; i++) {
            if (float(i) >= uLightCount) break;
            vec3 L = uLights[i].xyz - vWorld; float d = length(L);
            c += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.5) * (vCol * 0.6 + pow(max(dot(R, L / d), 0.0), 40.0));
        }
        c *= vW > 0.0 ? 1.0 + vW : 1.0;                                        // highlight (hint / selection)
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.75, 1.0, lum(o)) * 0.9 + vW * 0.3); return;
    }
    vec3 alb = vCol;
    vec3 c = alb * (vec3(0.14, 0.1, 0.16) + KEYC * max(dot(n, KEY), 0.0) * 0.95);
    if (mat == 1.0) { vec3 H = normalize(KEY + V); c += KEYC * pow(max(dot(n, H), 0.0), 60.0) * 0.6 + studio(reflect(-V, n)) * 0.08; }
    for (int i = 0; i < 6; i++) {
        if (float(i) >= uLightCount) break;
        vec3 L = uLights[i].xyz - vWorld; float d = length(L);
        c += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.5) * alb * max(dot(n, L / d), 0.0);
    }
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
