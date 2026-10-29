// The Hollow Pines scene shaders (from Last Light / Saratoga GP / Forest Rally). Adds the flashlight (a spot light from
// the camera: uSpotP, uSpotD, uSpot = cos inner, cos outer, strength, fog glow) and the ghost material (mat 7: pale,
// half-transparent, fresnel-edged and flickering; drawn in the blended pass with uGhost = opacity, burn). Space.js attributes (pos, col) plus normal and UV
// attributes, and Space's camera uniforms.
//   world geometry — colour = texture × vertex colour × (sky/ground ambient + sun) + point lights, with fog;
//                    instanced meshes set uInst = 1 and their matrix in bone 0
//                    uMode: 0 lit, 1 unlit, 3 foliage (back-lit glow + wind), 4 grass (glow + stronger wind),
//                           5 forest floor (the flat ground texture mixed with a drawn needles-and-moss detail texture)
//   uBake = 1 writes the raw texture colour and coverage (for rendering the tree impostors at load)
//   Wick           — vertex colours, GPU-skinned (pos.w = 1000 + bone), soft shading with a warm rim
// Everything that sets the time of day is a uniform (sun direction and colour, sky, ambient, fog, night).
// col.a is the material id: 0 = world, 1 = soft (Wick), 3 = sky quad, 4 = glow sprite, 6 = contact shadow.
// Alpha holds the depth-of-field circle of confusion for post.js, except in the blended pass.
export const NEAR = 0.01, FAR = 600.0;

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
uniform float uInst;
uniform float uMode;
uniform float uTime;
uniform float uWind;
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
    if (pos.w > 999.5 || uInst > 0.5) {
        int b = uInst > 0.5 ? 0 : int(pos.w - 999.5) * 3; vec4 q = vec4(p, 1.0);
        p = vec3(dot(uBone[b], q), dot(uBone[b + 1], q), dot(uBone[b + 2], q));
        vN = vec3(dot(uBone[b].xyz, nrm), dot(uBone[b + 1].xyz, nrm), dot(uBone[b + 2].xyz, nrm));
    } else if (mat == 4.0) {
        float corner = floor(pos.w / 100.0), size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vQ = c; p += (-xAxis * c.x + yAxis * c.y) * size;
    }
    // wind: foliage sways with height, grass blades bend at the tips (their vertex colour darkens toward the root)
    if (uMode > 2.5) {
        float ph = uTime * (uMode > 3.5 ? 2.3 : 0.9) + p.x * 0.35 + p.y * 0.27;
        float amt = uMode > 3.5 ? 0.04 * dot(col.rgb, vec3(0.33)) : 0.05 * clamp(p.z * 0.06, 0.0, 1.0);
        p.xy += vec2(sin(ph), cos(ph * 0.8)) * amt * uWind;
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
uniform vec3 uSunC;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uAmbS;
uniform vec3 uAmbG;
uniform vec4 uFog;
uniform float uNight;
uniform vec3 uDof;
uniform vec4 uLights[4];
uniform float uBake;
uniform sampler2D uDetail;
uniform vec3 uSpotP;
uniform vec3 uSpotD;
uniform vec4 uSpot;
uniform vec2 uGhost;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.75); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.1), 0.0, 1.0); }
// sky: a gradient from the horizon colour to the zenith, a warm glow around the sun, its disc, and stars at night
vec3 sky(vec3 d) {
    float h = d.z, s = max(dot(d, uSun), 0.0);
    vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.08, 0.55, h));
    c += uSunC * (pow(s, 6.0) * 0.35 + pow(s, 40.0) * 0.5) * (1.0 - uNight * 0.8);
    c += uSunC * smoothstep(0.9993, 0.99975, s) * 4.0 * step(-0.02, uSun.z);
    if (uNight > 0.01 && h > 0.0) {
        vec2 g = d.xy / (d.z + 1.0) * 260.0; vec2 id = floor(g); float st = hash(id);
        float tw = 0.6 + 0.4 * sin(uTime * (2.0 + st * 4.0) + st * 40.0);
        c += vec3(0.85, 0.9, 1.0) * step(0.9965, st) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * tw * uNight * 1.6;
        vec3 moon = normalize(vec3(-0.55, 0.6, 0.42)); float m = dot(d, moon);
        c += vec3(0.9, 0.92, 1.0) * (smoothstep(0.99955, 0.9997, m) * 1.6 + pow(max(m, 0.0), 60.0) * 0.12) * uNight;
    }
    return c;
}
float coc(float dist) { float nearB = smoothstep(uDof.x * 0.5, uDof.x * 0.2, dist) * uDof.z; float farB = smoothstep(uDof.x * 2.5, uDof.x * 40.0, dist) * uDof.y; return min(0.96, max(nearB, farB)); }
void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vQ.x * (1.6 / veriables.y) + yAxis * vQ.y * (1.6 / (veriables.y * aspect))); gl_FragColor = vec4(tone(sky(d)), 1.0); return; }
    if (mat == 4.0) { float k = max(exp(-dot(vQ, vQ) * 3.2) - 0.04, 0.0); gl_FragColor = vec4(vCol.rgb * k, 0.0); return; }
    if (mat == 6.0) { float k = 1.0 - (1.0 - smoothstep(0.0, 1.0, length(vCol.rg))) * vCol.b; gl_FragColor = vec4(vec3(k), 1.0); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    vec3 alb = vCol.rgb; float a = 1.0;
    if (mat == 7.0) {                                                           // Agnes
        vec3 gn = normalize(vN + vec3(0.0, 0.0, 1e-5)); float fr = pow(1.0 - abs(dot(gn, V)), 2.2);
        float flick = 0.75 + 0.25 * sin(uTime * 37.0 + vWorld.z * 13.0) * sin(uTime * 23.0);
        float nz = hash(floor(vWorld.xy * 40.0 + uTime * 9.0));
        // a steady inner pallor (so a face turned toward you reads as a face), brighter at the edges
        vec3 gc = alb * (0.42 + fr * 0.55) * flick + vec3(0.45, 0.6, 0.75) * fr * 0.3;
        vec3 Ls = uSpotP - vWorld; float ds = length(Ls); vec3 gl = Ls / ds; float cone = smoothstep(uSpot.y, uSpot.x, dot(-gl, uSpotD));
        gc += alb * uSpot.z * cone * (0.25 + 0.6 * abs(dot(gn, gl))) * 0.55 / (1.0 + ds * ds * 0.05);   // the torch finds her
        gc = mix(gc, vec3(1.6, 0.6, 0.2) * (0.6 + nz), uGhost.y);                     // burning before the cross
        float ga = uGhost.x * (0.45 + 0.55 * fr) * (0.85 + 0.3 * nz) + uGhost.y * 0.5;
        gc = mix(gc, uFog.rgb, clamp(1.0 - exp(-dist * uFog.w), 0.0, 0.9));
        gl_FragColor = vec4(tone(gc), clamp(ga, 0.0, 1.0)); return;
    }
    if (uUseTex > 0.5) {
        vec4 t = texture2D(uTex, vUV);
        a *= t.a;
        if (a < uCut) discard;
        alb *= t.rgb;
    }
    if (uBake > 0.5) { gl_FragColor = vec4(alb, a); return; }
    if (uMode > 4.5) { vec3 d1 = texture2D(uDetail, vWorld.xy * 1.15).rgb, d2 = texture2D(uDetail, vWorld.xy * 0.23 + 0.37).rgb; alb = mix(alb * 1.3, d1 * (0.55 + d2 * 0.9), 0.75); }
    vec3 n = vN;
#ifdef GL_OES_standard_derivatives
    if (dot(n, n) < 0.01) n = cross(dFdx(vWorld), dFdy(vWorld));
#endif
    n = normalize(n + vec3(0.0, 0.0, 1e-5));
    // two-sided surfaces face the viewer, except foliage and grass: their cards carry soft, mostly upward normals, and
    // flipping those for anything above the camera would light the top half of the view from below
    if (uMode < 2.5 && dot(n, V) < 0.0) n = -n;
    vec3 c;
    if (uMode > 0.5 && uMode < 1.5) c = alb * 1.05;                                   // unlit
    else {
        float dl = max(dot(n, uSun), 0.0) * smoothstep(-0.05, 0.08, uSun.z);
        vec3 amb = mix(uAmbG, uAmbS, n.z * 0.5 + 0.5);
        if (mat == 1.0) {                                                         // Wick: soft, warm rim
            float rim = pow(1.0 - abs(dot(n, V)), 2.5);
            dl = smoothstep(0.0, 0.6, dl * 0.8 + 0.2 * smoothstep(-0.05, 0.08, uSun.z));
            c = alb * (amb * 1.1 + uSunC * dl * 0.85) + (uSunC * 0.5 + vec3(0.35, 0.3, 0.2)) * rim * 0.3;
        } else c = alb * (amb + uSunC * dl);
        // foliage and grass: light through the needles and blades when the low sun is behind them
        if (uMode > 2.5) c += alb * uSunC * pow(max(dot(-V, uSun), 0.0), 5.0) * (uMode > 3.5 ? 0.9 : 1.4) * smoothstep(-0.05, 0.1, uSun.z);
        // the flashlight: a cone from the camera
        { vec3 Ls = uSpotP - vWorld; float ds = length(Ls); vec3 l = Ls / ds; float cone = smoothstep(uSpot.y, uSpot.x, dot(-l, uSpotD));
          float facing = uMode > 2.5 ? 0.55 + 0.45 * abs(dot(n, l)) : 0.25 + 0.75 * max(dot(n, l), 0.0);
          c += alb * vec3(1.0, 0.93, 0.8) * uSpot.z * cone * facing / (1.0 + ds * ds * 0.045); }
        // warm point lights: candles (w = strength)
        for (int i = 0; i < 4; i++) { vec3 L = uLights[i].xyz - vWorld; float ld2 = dot(L, L); c += alb * vec3(1.0, 0.85, 0.45) * uLights[i].w * (0.4 + 0.6 * max(dot(n, normalize(L)), 0.0)) / (1.0 + ld2 * 6.0); }
    }
    if (uMode < 0.5 || uMode > 1.5) {
        float f = clamp(1.0 - exp(-dist * uFog.w), 0.0, 0.97); c = mix(c, mix(uFog.rgb, sky(-V) * 0.9, 0.5), f);
        // the beam lit up in the fog: looking along the torch, nearer fog glows
        float along = smoothstep(uSpot.y - 0.02, uSpot.x, dot(-V, uSpotD)); c += vec3(0.9, 0.85, 0.75) * along * uSpot.w * f * (1.0 - f * 0.6);
    }
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
    for (const n of ["aspect", "veriables", "uTime", "uTex", "uUseTex", "uCut", "uBlend", "uMode", "uSun", "uSunC", "uSkyTop", "uSkyHor", "uAmbS", "uAmbG", "uFog", "uNight", "uDof", "uBone", "uLights", "uInst", "uWind", "uBake", "uDetail", "uSpotP", "uSpotD", "uSpot", "uGhost"]) U[n] = loc(n);
    return U;
}
