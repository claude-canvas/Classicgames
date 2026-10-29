// Coastline Rush scene shaders. Same attributes and camera uniforms as Space.js. col.a = material, pos.w = data.
// Golden-hour lighting: a low sun (SUN) with warm light + sky ambient, up to 8 point lights (lamps, head/tail lights).
//   0 MATTE   1 HULL  car paint: metallic flake + clear-coat sky reflection   2 GLASS  dark tinted glass
//   3 BG sky  4 SPRITE  5 EMIT  7 ADD
//   8 ROAD    asphalt: grain, centre dashes, edge lines, red/white curbs (vCol.r = s, vCol.g = curb, pos.w = x)
//   9 SEA     ocean: two-scale ripples, sun glitter road, Fresnel sky, depth tint, shore foam (pos.w = depth)
//  10 LAND    island ground: grass/sand/rock blended by height & slope   11 FOLIAGE palms, bushes (sway in VS)
//  12 METAL   rails, posts, lamp poles
export const NEAR = 0.1, FAR = 5000.0;

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
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
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
    } else if (mat == 11.0) { float sw = pos.w; p.x += sin(uTime * 1.3 + p.y * 0.05) * sw * 0.5; p.y += cos(uTime * 1.1 + p.x * 0.05) * sw * 0.3; }
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
varying float vW;
varying vec3 vWorld;
varying vec2 vUV;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;
uniform float aspect;
uniform float uTime;
uniform vec3 uSun;
uniform vec4 uLights[8];
uniform vec3 uLightCol[8];
uniform float uLightCount;

const vec3 SUNC = vec3(2.0, 1.15, 0.6);
const vec3 AMB_T = vec3(0.32, 0.3, 0.45);
const vec3 AMB_B = vec3(0.22, 0.14, 0.12);
vec3 tone(vec3 c) { c = vec3(1.0) - exp(-c * 1.25); float l = dot(c, vec3(0.299, 0.587, 0.114)); return clamp(mix(vec3(l), c, 1.18), 0.0, 1.0); }
float lum(vec3 c) { return max(c.r, max(c.g, c.b)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 skyLite(vec3 d) {
    float h = d.z, s = max(dot(d, uSun), 0.0);
    vec3 c = mix(vec3(1.0, 0.55, 0.32), vec3(0.18, 0.2, 0.45), smoothstep(-0.02, 0.5, h));
    c = mix(c, vec3(0.75, 0.38, 0.5), smoothstep(0.08, 0.25, h) * (1.0 - smoothstep(0.25, 0.6, h)) * 0.4);
    c += vec3(1.5, 0.7, 0.3) * (pow(s, 6.0) * 0.6 + pow(s, 40.0) * 0.9);
    return mix(c, vec3(0.5, 0.3, 0.3), smoothstep(0.0, -0.2, h));
}
vec3 sky(vec3 d) {
    vec3 c = skyLite(d); float s = max(dot(d, uSun), 0.0);
    c += vec3(3.0, 2.0, 1.0) * smoothstep(0.9985, 0.9993, s);
    if (d.z > 0.0) { vec2 q = d.xy / (d.z + 0.12) * 0.8 + vec2(uTime * 0.003, 0.0); float n = fbm(q * vec2(0.8, 2.0)); float cl = smoothstep(0.5, 0.78, n) * smoothstep(0.0, 0.08, d.z) * smoothstep(0.6, 0.15, d.z); c = mix(c, mix(vec3(0.6, 0.35, 0.45), vec3(2.0, 1.0, 0.5), pow(s, 2.0) + 0.3 * (1.0 - n)), cl * 0.8); }
    return c;
}
vec3 lights(vec3 n) { vec3 acc = vec3(0.0); for (int i = 0; i < 8; i++) { if (float(i) >= uLightCount) break; vec3 L = uLights[i].xyz - vWorld; float d = length(L); acc += uLightCol[i] * uLights[i].w / (1.0 + d * d * 0.15) * (0.3 + 0.7 * max(dot(n, L / d), 0.0)); } return acc; }
vec3 shade(vec3 alb, vec3 n, float wrap) { float dl = max((dot(n, uSun) + wrap) / (1.0 + wrap), 0.0); return alb * (mix(AMB_B, AMB_T, n.z * 0.5 + 0.5) + SUNC * dl + lights(n)); }
vec3 fogc(vec3 c, float dist) { vec3 d = normalize(vWorld - cPoint); return mix(c, skyLite(vec3(d.xy, max(d.z, 0.0) * 0.3)), clamp((1.0 - exp(-dist * 0.0009)), 0.0, 0.9)); }

void main() {
    float mat = floor(vMat + 0.5);
    if (mat == 3.0) { vec3 d = normalize(zAxis - xAxis * vUV.x * (1.6 / veriables.y) + yAxis * vUV.y * (1.6 / (veriables.y * aspect))); vec3 o = tone(sky(d)); gl_FragColor = vec4(o, smoothstep(0.85, 1.0, lum(o)) * 0.7); return; }
    vec3 V = cPoint - vWorld; float dist = length(V); V /= dist;
    if (mat == 4.0) { float k = max(exp(-dot(vUV, vUV) * 3.2) - 0.04, 0.0); vec3 o = tone(vCol * k); gl_FragColor = vec4(o, lum(o) * 1.4); return; }
    if (mat == 7.0) { vec3 o = tone(vCol); gl_FragColor = vec4(o, lum(o) * 0.9); return; }
    if (mat == 5.0) { gl_FragColor = vec4(tone(vCol), 0.9); return; }
    if (mat == 9.0) {                                                         // ocean
        vec2 q = vWorld.xy * 0.06 + vec2(uTime * 0.05, uTime * 0.03), q2 = vWorld.xy * 0.35 - uTime * 0.15;
        float e = 0.05;
        float h0 = fbm(q) + 0.3 * vnoise(q2), hx = fbm(q + vec2(e, 0.0)) + 0.3 * vnoise(q2 + vec2(e * 6.0, 0.0)), hy = fbm(q + vec2(0.0, e)) + 0.3 * vnoise(q2 + vec2(0.0, e * 6.0));
        vec3 n = normalize(vec3(-(hx - h0) / e * 0.06, -(hy - h0) / e * 0.06, 1.0));
        vec3 R = reflect(-V, n); R.z = abs(R.z);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        float depth = clamp(vW / 25.0, 0.0, 1.0);
        vec3 water = mix(vec3(0.15, 0.55, 0.55), vec3(0.03, 0.12, 0.22), depth);
        vec3 c = water * (AMB_T * 0.7 + SUNC * 0.15) + skyLite(R) * fres * 1.1 + vec3(3.0, 1.8, 0.8) * pow(max(dot(R, uSun), 0.0), 180.0) * 2.0;
        float foam = smoothstep(0.12, 0.0, depth - 0.02 * sin(uTime * 1.5 + vWorld.x * 0.1)) * smoothstep(0.35, 0.6, vnoise(vWorld.xy * 0.4 + uTime * 0.2));
        c = mix(c, vec3(0.9, 0.85, 0.8) * (AMB_T + SUNC * 0.5), foam * 0.8);
        vec3 o = tone(fogc(c, dist));
        gl_FragColor = vec4(o, smoothstep(0.8, 1.0, lum(o)) * 0.6); return;
    }
#ifdef GL_OES_standard_derivatives
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
#else
    vec3 n = vec3(0.0, 0.0, 1.0);
#endif
    if (dot(n, V) < 0.0) n = -n;
    if (mat == 8.0) {                                                         // road
        float s = vCol.r, x = vW, curb = vCol.g;
        vec3 alb = vec3(0.13, 0.13, 0.15) * (0.85 + 0.25 * vnoise(vec2(x * 3.0, s * 3.0)) + 0.1 * vnoise(vec2(x * 30.0, s * 30.0)));
        alb *= 1.0 - 0.15 * smoothstep(1.2, 0.0, abs(abs(x) - 3.6));                   // tyre lines
        float dash = smoothstep(0.12, 0.06, abs(x)) * step(0.45, fract(s / 9.0));
        float edgeL = smoothstep(0.12, 0.05, abs(abs(x) - 6.9));
        alb = mix(alb, vec3(0.9, 0.88, 0.8), max(dash, edgeL));
        float cb = curb * step(7.05, abs(x));
        alb = mix(alb, mix(vec3(0.85, 0.1, 0.1), vec3(0.95, 0.95, 0.95), step(0.5, fract(s / 2.0))), cb);
        if (abs(x) > 7.5) alb = mix(vec3(0.55, 0.48, 0.36), alb, cb);
        vec3 c = shade(alb, n, 0.1);
        vec3 R = reflect(-V, n); float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
        c += skyLite(R) * fres * 0.5 + SUNC * pow(max(dot(R, uSun), 0.0), 40.0) * 0.35;
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.0); return;
    }
    if (mat == 10.0) {                                                        // land
        float z = vWorld.z, slope = 1.0 - n.z;
        vec3 grass = mix(vec3(0.24, 0.34, 0.1), vec3(0.36, 0.42, 0.14), vnoise(vWorld.xy * 0.05)) * (0.85 + 0.3 * vnoise(vWorld.xy * 0.8));
        vec3 sand = vec3(0.82, 0.68, 0.46) * (0.9 + 0.15 * vnoise(vWorld.xy * 0.5));
        vec3 rock = vec3(0.45, 0.36, 0.3) * (0.8 + 0.3 * vnoise(vWorld.xy * 0.3 + z * 0.2));
        vec3 alb = mix(sand, grass, smoothstep(1.5, 4.0, z + vnoise(vWorld.xy * 0.1) * 2.0));
        alb = mix(alb, rock, smoothstep(0.35, 0.6, slope));
        alb *= vCol;
        gl_FragColor = vec4(tone(fogc(shade(alb, n, 0.2), dist)), 0.0); return;
    }
    if (mat == 11.0) { float back = pow(max(dot(-V, uSun), 0.0), 3.0); vec3 alb = vCol * (0.8 + 0.35 * vnoise(vWorld.xy * 2.0 + vWorld.z)); vec3 c = shade(alb, n, 0.6) + alb * SUNC * back * 0.6; gl_FragColor = vec4(tone(fogc(c, dist)), 0.0); return; }
    if (mat == 1.0) {                                                         // car paint
        vec3 R = reflect(-V, n); float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        float flake = 0.9 + 0.2 * hash12(floor(vWorld.xy * 80.0 + vWorld.z * 60.0));
        vec3 c = shade(vCol * flake, n, 0.1) * 0.8 + sky(R) * (0.12 + fres * 0.8) + SUNC * pow(max(dot(R, uSun), 0.0), 90.0) * 1.2;
        gl_FragColor = vec4(tone(fogc(c, dist)), 0.1); return;
    }
    if (mat == 2.0) { vec3 R = reflect(-V, n); float fres = 0.1 + 0.9 * pow(1.0 - max(dot(n, V), 0.0), 3.0); vec3 c = vec3(0.02, 0.025, 0.03) + skyLite(R) * fres * 0.9 + SUNC * pow(max(dot(R, uSun), 0.0), 80.0); gl_FragColor = vec4(tone(fogc(c, dist)), 0.0); return; }
    vec3 c = shade(vCol, n, 0.2);
    if (mat == 12.0) { vec3 R = reflect(-V, n); c += skyLite(R) * 0.25 + SUNC * pow(max(dot(R, uSun), 0.0), 30.0) * 0.4; }
    gl_FragColor = vec4(tone(fogc(c, dist)), 0.0);
}`;

export function createProgram(gl, space) {
    gl.getExtension("OES_standard_derivatives");
    const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, make(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(program, space.posId, "pos"); gl.bindAttribLocation(program, space.colId, "col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = (n) => gl.getUniformLocation(program, n);
    Object.assign(space, { program, cPointLoc: loc("cPoint"), vPointLoc: loc("vPoint"), xAxisLoc: loc("xAxis"), yAxisLoc: loc("yAxis"), zAxisLoc: loc("zAxis"), varsLocation: loc("veriables") });
    gl.useProgram(program);
    const U = { program };
    for (const n of ["aspect", "veriables", "uTime", "uSun", "uLights", "uLightCol", "uLightCount"]) U[n] = loc(n);
    return U;
}
