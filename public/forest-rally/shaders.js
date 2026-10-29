// Forest Rally scene shaders. Space.js attributes (pos, col) plus normal and UV attributes, and Space's camera
// uniforms. Two kinds of geometry share the program:
//   textured map geometry   — colour = texture × vertex colour (baked light from the model) × sun/sky lighting;
//                             uMode: 0 lit, 1 unlit (sky dome, light shafts, far backdrop), 2 water (scrolling UVs)
//   the character            — vertex colours, GPU-skinned (pos.w = 1000 + bone, bones in uBone), soft shading
// col.a is the material id: 0 = map, 1 = character (soft), 3 = sky gradient quad, 4 = sprite, 6 = contact shadow.
// Alpha holds the depth-of-field circle of confusion for post.js, except in the blended pass.
export const NEAR = 0.05, FAR = 2500.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
attribute vec3 nrm;
attribute vec2 uv;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform vec4 uBone[69];
varying vec4 vCol;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUV;
varying vec2 vQ;
varying float vMat;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col; vUV = uv; vN = nrm; vQ = vec2(0.0);
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vQ = pos.xy; return; }
    vec3 p = pos.xyz;
    if (pos.w > 999.5) {
        int b = int(pos.w - 999.5) * 3; vec4 q = vec4(p, 1.0);
        p = vec3(dot(uBone[b], q), dot(uBone[b + 1], q), dot(uBone[b + 2], q));
        vN = vec3(dot(uBone[b].xyz, nrm), dot(uBone[b + 1].xyz, nrm), dot(uBone[b + 2].xyz, nrm));
    } else if (mat == 4.0) {
        float corner = floor(pos.w / 100.0), size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vQ = c; p += (-xAxis * c.x + yAxis * c.y) * size;
    }
    vWorld = p;
    vec3 v = p - cPoint;
    float xp = -dot(v, xAxis), yp = dot(v, yAxis), zp = dot(v, zAxis);
    float k = veriables.y / 1.6;
    const float N = ${NEAR.toFixed(3)}, F = ${FAR.toFixed(1)};
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
varying vec4 vCol;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUV;
varying vec2 vQ;
varying float vMat;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uCut;
uniform float uBlend;
uniform float uMode;
uniform vec3 uSun;
uniform vec3 uDof;
uniform vec4 uLight;
const vec3 SUNC = vec3(1.25, 1.12, 0.95);
const vec3 SKY = vec3(0.55, 0.68, 0.85);
const vec3 GND = vec3(0.32, 0.3, 0.22);
const vec3 FOG = vec3(0.7, 0.8, 0.9);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.45); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.12), 0.0, 1.0); }
vec3 sky(vec3 d) { float h = d.z, s = max(dot(d, uSun), 0.0); vec3 c = mix(vec3(0.9, 0.93, 0.95), vec3(0.35, 0.58, 0.92), smoothstep(-0.05, 0.6, h)); return c + vec3(1.0, 0.9, 0.7) * (pow(s, 8.0) * 0.3 + pow(s, 300.0) * 2.0); }
float coc(float dist) { float nearB = smoothstep(uDof.x * 0.5, uDof.x * 0.25, dist) * uDof.z; float farB = smoothstep(uDof.x * 4.0, uDof.x * 30.0, dist) * uDof.y; return min(0.96, max(nearB, farB)); }
void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vQ.x * (1.6 / veriables.y) + yAxis * vQ.y * (1.6 / (veriables.y * aspect))); gl_FragColor = vec4(tone(sky(d)), 1.0); return; }
    if (mat == 4.0) { float k = max(exp(-dot(vQ, vQ) * 3.2) - 0.04, 0.0); gl_FragColor = vec4(vCol.rgb * k, 0.0); return; }
    if (mat == 6.0) { float k = 1.0 - (1.0 - smoothstep(0.0, 1.0, length(vCol.rg))) * vCol.b; gl_FragColor = vec4(vec3(k), 1.0); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    vec3 alb = vCol.rgb; float a = 1.0;
    if (uUseTex > 0.5) {
        vec2 uv = vUV;
        if (uMode > 1.5) uv += vec2(uTime * 0.02, -uTime * 0.05);
        vec4 t = texture2D(uTex, uv);
        a *= t.a;
        if (a < uCut) discard;
        alb *= t.rgb;
    }
    vec3 n = vN;
#ifdef GL_OES_standard_derivatives
    if (dot(n, n) < 0.01) n = cross(dFdx(vWorld), dFdy(vWorld));
#endif
    n = normalize(n + vec3(0.0, 0.0, 1e-5));
    if (dot(n, V) < 0.0) n = -n;
    vec3 c;
    if (uMode > 0.5 && uMode < 1.5) c = alb * 1.05;                                   // unlit
    else {
        float dl = max(dot(n, uSun), 0.0);
        vec3 amb = mix(GND, SKY, n.z * 0.5 + 0.5);
        if (mat == 1.0) {                                                         // character: soft, warm rim
            float rim = pow(1.0 - abs(dot(n, V)), 2.5);
            dl = smoothstep(0.0, 0.6, dl * 0.8 + 0.2);
            c = alb * (amb * 0.9 + SUNC * dl * 0.85) + vec3(1.0, 0.9, 0.75) * rim * 0.22;
        } else c = alb * (amb * 0.75 + SUNC * (0.35 + 0.65 * dl));
        vec3 L = uLight.xyz - vWorld; float ld = length(L);
        c += alb * vec3(1.0, 0.7, 0.4) * uLight.w / (1.0 + ld * ld * 0.4);
        if (uMode > 1.5) { vec3 R = reflect(-V, n); c = mix(c, sky(R), 0.35) + vec3(1.0) * pow(max(dot(R, uSun), 0.0), 120.0) * 0.6; }
    }
    if (uMode < 0.5 || uMode > 1.5) c = mix(c, FOG, clamp(1.0 - exp(-dist * 0.0022), 0.0, 0.75));
    c = tone(c);
    gl_FragColor = uBlend > 0.5 ? vec4(c, a) : vec4(c, coc(dist));
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos"); gl.bindAttribLocation(program, space.colId, "col");
    gl.bindAttribLocation(program, space.nrmId, "nrm"); gl.bindAttribLocation(program, space.uvId, "uv");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, { program, cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"), xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"), varsLocation: loc("veriables") });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uTime", "uTex", "uUseTex", "uCut", "uBlend", "uMode", "uSun", "uDof", "uBone", "uLight"]) U[n] = loc(n);
    return U;
}
