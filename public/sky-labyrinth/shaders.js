// Sky Labyrinth scene shaders. Same attributes and camera uniforms as Space.js (pos, col, cPoint, xAxis, yAxis,
// zAxis, veriables). col.a = material, pos.w = per-material data. Everything on the tablet is drawn in board-local
// coordinates and turned into the world by uModel (the tilt); scenery is drawn with uModel = identity.
//
//   0 MATTE   stone, rock, foliage (pos.w = 1: carved wall stone with courses)
//   1 GOLD    polished gold / brass: reflects the sky
//   2 FLOOR   tablet floor (pos.w: 0 stone · 1 moss · 2 crumble · 3 plate). Receives real shadows: the wall
//             height texture is ray-marched toward the light, plus an analytic ray–sphere test for the marble
//   3 BG      sky with sun + an infinite sea of clouds below the horizon
//   4 SPRITE  additive glow (pos.w = size + corner·100) · 5 EMIT emissive
//   6 SHADOW  multiply contact shadow (pos.w = u·2 + v, col.r = strength) · 7 ADD additive
//   8 GLASS   the marble: Fresnel sky reflection, sun glint, refracted cat's-eye swirl (col.rgb = ball-frame dir)
//   9 ICE     crystalline floor: gloss, reflections, frosted cracks, receives shadows
//  10 HOLE    shaft walls darken with depth; pos.w = 1 is the bottom, a window onto the clouds below
//  11 GEM     faceted crystal with an inner glow

export const NEAR = 0.2, FAR = 600.0, HSCALE = 1.0;

export const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform mat3 uModel;
uniform float uBuild;
varying vec3 vCol;
varying float vMat;
varying float vW;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec2 vUV;
void main() {
    float mat = floor(col.a + 0.5);
    vMat = mat; vCol = col.rgb; vUV = vec2(0.0); vW = pos.w;
    if (mat == 3.0) { gl_Position = vec4(pos.xy, 0.99999, 1.0); vWorld = cPoint; vLocal = vec3(0.0); vUV = pos.xy; return; }
    vec3 p = pos.xyz;
    if (uBuild < 1.0) {                                   // the tablet assembles itself: tiles rise in a wave
        float k = clamp((uBuild * 1.6 - length(p.xy) * 0.045) * 2.2, 0.0, 1.0);
        p.z -= (1.0 - k) * (1.0 - k) * 9.0;
    }
    vLocal = p;
    if (mat == 4.0) {
        float corner = floor(pos.w / 100.0);
        float size = pos.w - corner * 100.0;
        vec2 c = corner < 0.5 ? vec2(-1.0, -1.0) : corner < 1.5 ? vec2(1.0, -1.0) : corner < 2.5 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
        vUV = c;
        p = uModel * p + (-xAxis * c.x + yAxis * c.y) * size;
    } else {
        if (mat == 6.0) { float u = step(1.5, pos.w); vUV = vec2(u, pos.w - 2.0 * u); }
        p = uModel * p;
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
#ifdef GL_EXT_shader_texture_lod
#extension GL_EXT_shader_texture_lod : enable
#define TEX(s, uv) texture2DLodEXT(s, uv, 0.0)
#else
#define TEX(s, uv) texture2D(s, uv)
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
varying vec3 vLocal;
varying vec2 vUV;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uLightL;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHor;
uniform vec3 uCloud;
uniform vec3 uCloudShade;
uniform sampler2D uHeight;
uniform vec2 uGrid;
uniform vec4 uBall;
uniform vec3 uBallW;
uniform mat3 uBallRot;
uniform vec3 uCore;
uniform float uLocal;

vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.25); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.18), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }

vec3 skyGrad(vec3 d) {
    float h = d.z;
    vec3 c = mix(uSkyHor, uSkyMid, smoothstep(0.0, 0.2, h));
    c = mix(c, uSkyTop, smoothstep(0.16, 0.8, h));
    c = mix(c, mix(uCloud, uSkyHor, 0.5) * 0.9, smoothstep(0.0, -0.1, h));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.6);
    return c;
}
vec3 skyFull(vec3 d) {
    vec3 c = skyGrad(d);
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * smoothstep(0.9986, 0.9993, s) * 5.0;
    if (d.z < -0.004) {
        float t = (cPoint.z + 70.0) / -d.z;
        vec2 w = cPoint.xy + d.xy * t;
        vec2 q = w * 0.014 + vec2(uTime * 0.006, uTime * 0.0025);
        float n = fbm(q), n2 = vnoise(q * 4.3 + 7.0);
        float hgt = n + n2 * 0.18;
        vec2 qs = q - uSunDir.xy * 0.05;
        float lit = clamp(0.55 + (n - vnoise(qs) * 0.5 - vnoise(qs * 2.03 + vec2(1.7, 9.2)) * 0.25 - 0.19) * 5.0, 0.0, 1.2);
        vec3 cl = mix(uCloudShade, uCloud, smoothstep(0.28, 0.72, hgt)) * (0.7 + 0.45 * lit);
        vec2 sd = normalize(uSunDir.xy + 1e-4);
        float fwd = max(dot(normalize(d.xy + 1e-4), sd), 0.0);
        cl += uSunCol * pow(fwd, 5.0) * 0.4 * smoothstep(0.4, 0.75, hgt);
        float haze = smoothstep(-0.32, -0.006, d.z);
        c = mix(cl, c, haze * haze);
    }
    return c;
}

float shadowAt(vec3 lp) {
    float s = 0.0;
    vec3 dir = uLightL / max(uLightL.z, 0.2);
    for (int i = 1; i <= 8; i++) {
        float h = float(i) * 0.082;
        vec3 q = lp + dir * h;
        vec4 t = TEX(uHeight, vec2((q.x + uGrid.x * 0.5) / uGrid.x, (uGrid.y * 0.5 - q.y) / uGrid.y));
        float occ = smoothstep(0.3, 0.7, t.r);
        s = max(s, occ * smoothstep(t.g * ${HSCALE.toFixed(1)} + 0.02, t.g * ${HSCALE.toFixed(1)} - 0.05, q.z));
    }
    vec3 oc = uBall.xyz - lp;
    float tb = dot(oc, uLightL);
    if (tb > 0.0) { float d = length(oc - uLightL * tb); s = max(s, 1.0 - smoothstep(uBall.w * 0.55, uBall.w * 1.25, d)); }
    return 1.0 - s * 0.88;
}
float aoAt(vec3 lp) {
    float o = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 off = vec2(i == 0 ? 0.32 : i == 1 ? -0.32 : 0.0, i == 2 ? 0.32 : i == 3 ? -0.32 : 0.0);
        vec2 q = lp.xy + off;
        o += smoothstep(0.3, 0.7, TEX(uHeight, vec2((q.x + uGrid.x * 0.5) / uGrid.x, (uGrid.y * 0.5 - q.y) / uGrid.y)).r);
    }
    vec2 bd = lp.xy - uBall.xy;
    float ball = exp(-dot(bd, bd) / (uBall.w * uBall.w) * 1.6) * smoothstep(0.6, 0.0, uBall.z - uBall.w);
    return (1.0 - o * 0.1) * (1.0 - ball * 0.55);
}
vec3 shade(vec3 alb, vec3 n, vec3 V, float gloss, float sh, float ao) {
    float dl = max(dot(n, uLightDir), 0.0);
    vec3 amb = mix(mix(uSkyHor, uCloudShade, 0.5) * 0.26, uSkyTop * 0.34 + uSkyMid * 0.18, n.z * 0.5 + 0.5);
    vec3 c = alb * (amb * ao + uSunCol * dl * sh * 1.55);
    vec3 H = normalize(uLightDir + V);
    c += uSunCol * pow(max(dot(n, H), 0.0), mix(12.0, 220.0, gloss)) * gloss * sh * 1.3;
    c += alb * uCloud * 0.1 * max(-n.z, 0.0);
    return c;
}

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) {
        vec2 ndc = vUV;
        vec3 d = normalize(zAxis - xAxis * ndc.x * (1.6 / veriables.y) + yAxis * ndc.y * (1.6 / (veriables.y * aspect)));
        vec3 o = tone(skyFull(d));
        gl_FragColor = vec4(o, smoothstep(0.975, 1.0, lum(o)) * 0.7); return;
    }
    vec3 V = normalize(cPoint - vWorld);
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 6.0) { vec2 q = abs(vUV * 2.0 - 1.0); float r = length(q); gl_FragColor = vec4(vec3(1.0 - (1.0 - smoothstep(0.2, 1.0, r)) * vCol.r), 1.0); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    vec3 lp = vLocal;
    if (mat == 8.0) {                                                  // glass marble
        vec3 N = normalize(vWorld - uBallW);
        float cs = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cs, 4.0);
        vec3 R = reflect(-V, N);
        vec3 refl = skyGrad(R);
        vec3 rr = refract(-V, N, 0.67);
        vec3 pin = N * 0.72 + rr * 0.55;                              // a point inside the glass
        vec3 l = vec3(dot(pin, uBallRot[0]), dot(pin, uBallRot[1]), dot(pin, uBallRot[2]));
        float ang = atan(l.y, l.x);
        float band = abs(l.z + 0.16 * sin(ang * 3.0 + l.z * 4.0));
        float rib = smoothstep(0.2, 0.06, band) * smoothstep(0.02, 0.3, length(l.xy));
        vec3 body = vec3(0.03, 0.07, 0.12);
        vec3 through = mix(uSkyHor, uSkyTop, rr.z * 0.5 + 0.5) * 0.22;
        vec3 core = uCore * (0.9 + 0.9 * max(dot(rr, -uLightDir) * 0.5 + 0.5, 0.0));
        vec3 c = mix(body + through, core, rib * 0.92);
        c += uCore * 0.25 * pow(max(dot(-N, uLightDir), 0.0), 2.0);   // light focusing through the far side
        c = mix(c, refl, fres);
        c += uSunCol * pow(max(dot(R, uLightDir), 0.0), 600.0) * 7.0 + uSunCol * pow(max(dot(R, uLightDir), 0.0), 40.0) * 0.35;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.82, 1.0, lum(o)) * 0.8); return;
    }
    if (mat == 2.0 || mat == 9.0) {                                    // tablet floor + ice (one shadow march)
        vec2 cell = floor(lp.xy + 0.5), f = lp.xy + 0.5 - cell;
        float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float rnd = hash12(cell);
        float st = floor(vW + 0.5);
        float ice = mat == 9.0 ? 1.0 : 0.0;
        vec3 alb = vCol * (0.9 + rnd * 0.1) * (mod(cell.x + cell.y, 2.0) < 0.5 ? 1.0 : 0.88);
        float nz = vnoise(lp.xy * (st == 1.0 ? 6.0 : 3.0) + rnd * 9.0 * (1.0 - ice));
        if (ice > 0.5) {
            float cr = abs(nz - 0.5) * abs(vnoise(lp.xy * 7.0 + 3.0) - 0.5);
            alb = vCol * (0.75 + 0.25 * nz) + vec3(0.25, 0.35, 0.4) * smoothstep(0.012, 0.0, cr);
            alb *= 0.85 + 0.15 * smoothstep(0.0, 0.04, e);
        } else if (st == 1.0) {                                       // moss
            alb = mix(vCol * 0.55, vCol * 1.15, nz) * (0.85 + 0.3 * vnoise(lp.xy * 22.0));
        } else {
            float grout = smoothstep(0.015, 0.045, e);
            alb *= 0.7 + 0.3 * grout;
            vec2 g = f - 0.5;
            float ring = abs(length(g) - 0.3), dia = abs(abs(g.x) + abs(g.y) - 0.3);
            alb *= 1.0 - smoothstep(0.018, 0.0, min(ring, dia)) * grout * 0.16;
            alb *= 0.94 + 0.12 * nz;
            if (st == 2.0) alb *= mix(0.45, 1.0, smoothstep(0.0, 0.05, abs(vnoise(lp.xy * 5.0 + rnd * 7.0) - 0.5)));
        }
        float sh = shadowAt(lp), ao = aoAt(lp);
        vec3 c = shade(alb, n, V, ice > 0.5 ? 0.9 : st == 1.0 ? 0.0 : 0.18, sh, ao);
        if (ice > 0.5) {
            float fres = 0.08 + 0.9 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
            c = mix(c, skyGrad(reflect(-V, n)) * (0.5 + 0.5 * sh), fres * 0.7);
        }
        c += uCore * 0.06 * exp(-dot(lp.xy - uBall.xy, lp.xy - uBall.xy) * 6.0);
        gl_FragColor = vec4(tone(c), 0.0); return;
    }
    if (mat == 10.0) {                                                 // hole
        if (vW > 0.5) { vec2 hc = lp.xy - (floor(lp.xy + 0.5)); float vg = smoothstep(0.38, 0.05, length(hc)); vec3 o = tone(skyGrad(normalize(vWorld - cPoint)) * 0.32 * vg + vec3(0.01, 0.01, 0.03)); gl_FragColor = vec4(o, 0.0); return; }
        float dk = exp(lp.z * 9.0) * 0.7;
        gl_FragColor = vec4(tone(vCol * dk * (0.4 + 0.6 * max(dot(n, uLightDir), 0.0) + 0.3)), 0.0); return;
    }
    if (mat == 11.0) {                                                 // gem
        float cs = max(dot(n, V), 0.0);
        vec3 c = vCol * (0.35 + 0.9 * pow(1.0 - cs, 1.5)) + vCol * 0.6 * max(dot(n, uLightDir), 0.0);
        c += uSunCol * pow(max(dot(reflect(-V, n), uLightDir), 0.0), 60.0) * 2.0;
        c += skyGrad(reflect(-V, n)) * 0.25;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, 0.55 + lum(o) * 0.3); return;
    }
    if (mat == 1.0) {                                                  // gold
        vec3 R = reflect(-V, n);
        vec3 env = skyGrad(R);
        vec3 c = vCol * (env * 0.75 + uSunCol * pow(max(dot(R, uLightDir), 0.0), 30.0) * 1.6 + 0.04);
        c += vCol * uSunCol * max(dot(n, uLightDir), 0.0) * 0.35;
        vec3 o = tone(c);
        gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.6); return;
    }
    vec3 alb = vCol;
    float ao = 1.0;
    if (vW > 0.5 && vW < 1.5) {                                       // carved wall stone
        float course = smoothstep(0.0, 0.03, abs(fract(lp.z / 0.2 + 0.5) - 0.5) * 0.2);
        alb *= (0.78 + 0.22 * course) * (0.9 + 0.15 * vnoise(lp.xy * 4.0 + lp.z * 3.0));
        if (n.z < 0.7) ao = 0.75 + 0.25 * smoothstep(0.0, 0.5, lp.z);
    } else if (vW > 1.5) {                                            // rock with strata
        alb *= 0.8 + 0.3 * vnoise(vec2(lp.z * 2.5, lp.x * 0.6 + lp.y * 0.6));
    }
    vec3 c = shade(alb, n, V, 0.0, 1.0, ao);
    float fogk = uLocal > 0.5 ? 0.0 : smoothstep(40.0, 180.0, length(vWorld - cPoint));
    c = mix(c, skyGrad(normalize(vWorld - cPoint)), fogk * 0.85);
    gl_FragColor = vec4(tone(c), 0.0);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives"); gl.getExtension("EXT_shader_texture_lod");
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
    for (const n of ["aspect", "veriables", "uTime", "uModel", "uBuild", "uLightDir", "uLightL", "uSunDir", "uSunCol", "uSkyTop", "uSkyMid", "uSkyHor", "uCloud", "uCloudShade", "uHeight", "uGrid", "uBall", "uBallW", "uBallRot", "uCore", "uLocal"]) U[n] = loc(n);
    return U;
}
