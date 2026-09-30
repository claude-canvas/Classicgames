// Shaders for Aegis. Same attributes, uniforms and projection maths as Space.js,
// so Space.reDraw() drives them unchanged. The 4th component of `pos` is a material id:
//   2 = planet surface (col.a: -1 ocean, otherwise city-light amount)
//   3 = sky (full-screen quad: nebula, stars, sun and the atmosphere halo)
//   4 = lit object: meteors, towers, satellites (col.a 0..1 heat glow, 1..2 window glow)
//   5 = emissive, used by the additive glow pass
//   6 = clouds (additive haze, spun around the planet's axis by uCloud)

export function buildShaders(deriv) {
    const VERT = `
attribute vec4 pos;
attribute vec4 col;

uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;      // (zShifter, magnifier, unused) - set by Space

uniform vec2 uAspect;        // screen-shape correction so the canvas can fill any screen
uniform float uCloud;        // cloud layer rotation

varying vec4 vCol;
varying vec3 vW;
varying vec3 vView;
varying vec3 vDir;
varying vec3 vCam;
varying float vMat;

void main() {
    vCol = col;
    vMat = pos.w;
    vCam = cPoint;

    if (pos.w > 2.5 && pos.w < 3.5) {
        // sky: a screen quad whose per-corner view ray comes from Space's camera axes
        vDir = zAxis + xAxis * (pos.x * 1.6 / (veriables.y * uAspect.x)) + yAxis * (pos.y * 0.8 / (veriables.y * uAspect.y));
        vW = vec3(0.0);
        vView = vec3(0.0);
        gl_Position = vec4(pos.xy, 0.9999, 1.0);
        return;
    }

    vec3 w = pos.xyz;
    if (pos.w > 5.5 && pos.w < 6.5) {
        float c = cos(uCloud), s = sin(uCloud);
        w = vec3(w.x * c - w.y * s, w.x * s + w.y * c, w.z);
    }
    vW = w;
    vView = cPoint - w;
    vDir = vec3(0.0);

    vec3 rel = w - cPoint;
    float xProj = dot(rel, xAxis);
    float yProj = dot(rel, yAxis);
    float zProj = dot(rel, zAxis);

    // identical to Space.js's projection, plus the aspect correction
    float maxWidth = max(abs(zProj * 0.1 / veriables.y), 0.0001);
    gl_Position = vec4(xProj / (maxWidth * 16.0) * uAspect.x,
                       yProj / (maxWidth * 8.0) * uAspect.y,
                       zProj / 800.0 - veriables.x, 1.0);
}`;

    const FRAG = (deriv ? "#extension GL_OES_standard_derivatives : enable\n#define DERIV 1\n" : "") + `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec4 vCol;
varying vec3 vW;
varying vec3 vView;
varying vec3 vDir;
varying vec3 vCam;
varying float vMat;

uniform vec3 fSun;
uniform float fTime;
uniform float fFlash;        // red wash after a city is hit
uniform float fNova;         // golden wash while the nova fires

const float PR = 10.0;       // planet radius

float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                   mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                   mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// flat, low-poly face normal, turned toward the viewer
vec3 faceN() {
#ifdef DERIV
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
#else
    vec3 n = normalize(vW);
#endif
    if (dot(n, vView) < 0.0) n = -n;
    return n;
}

vec3 sky(vec3 d) {
    vec3 c = vec3(0.006, 0.008, 0.022);
    float n1 = noise(d * 2.2 + 3.1) * 0.6 + noise(d * 5.3) * 0.3 + noise(d * 11.0) * 0.1;
    float n2 = noise(d * 1.7 + 9.7);
    vec3 neb = mix(vec3(0.34, 0.08, 0.46), vec3(0.03, 0.3, 0.4), n2);
    c += neb * pow(n1, 3.0) * 0.6;
    // a faint galactic band
    float band = exp(-abs(dot(d, normalize(vec3(0.3, -0.5, 0.8)))) * 7.0);
    c += vec3(0.26, 0.22, 0.32) * band * (0.25 + 0.75 * n1) * 0.35;
    // stars
    vec3 p = d * 150.0;
    vec3 cell = floor(p);
    float h = hash3(cell);
    if (h > 0.968) {
        vec3 f = fract(p) - 0.5;
        float s = 1.0 - smoothstep(0.0, 0.2 + 0.2 * fract(h * 91.0), length(f));
        float tw = 0.6 + 0.4 * sin(fTime * (1.0 + h * 3.0) + h * 60.0);
        c += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), fract(h * 37.0)) * s * tw * (0.7 + band);
    }
    // the sun
    float sd = max(dot(d, fSun), 0.0);
    c += vec3(1.0, 0.82, 0.58) * (pow(sd, 1200.0) * 8.0 + pow(sd, 90.0) * 0.4 + pow(sd, 8.0) * 0.07);
    return c;
}

// atmosphere seen around the planet's limb
vec3 halo(vec3 d) {
    float b = -dot(vCam, d);
    if (b < 0.0) return vec3(0.0);
    vec3 cp = vCam + d * b;
    float r = length(cp);
    float h = r - PR;
    float g = exp(-max(h, 0.0) / 1.5);
    float l = dot(cp / r, fSun);
    float lit = smoothstep(-0.35, 0.55, l);
    vec3 c = mix(vec3(0.15, 0.3, 0.9), vec3(0.5, 0.8, 1.0), lit) * g * (0.1 + 0.95 * lit);
    c += vec3(1.0, 0.45, 0.2) * g * exp(-l * l / 0.02) * 0.45;   // sunset ring at the terminator
    return c;
}

vec3 planet() {
    vec3 n = faceN();
    vec3 ns = normalize(vW);
    vec3 v = normalize(vView);
    float ld = dot(ns, fSun);
    float day = smoothstep(-0.12, 0.25, ld);
    float diff = max(dot(n, fSun), 0.0);
    vec3 alb = vCol.rgb;
    vec3 c = alb * (0.03 + diff * 1.1 * day);
    if (vCol.a < -0.5) {
        vec3 r = reflect(-fSun, n);
        float sp = pow(max(dot(r, v), 0.0), 40.0) * day;
        c += vec3(1.0, 0.9, 0.75) * sp * 0.8;
        c += alb * 0.06 * (1.0 - day);
    } else {
        float lights = vCol.a * (1.0 - smoothstep(-0.2, 0.06, ld));
        c += vec3(1.0, 0.7, 0.32) * lights * 1.4;
    }
    float rim = pow(1.0 - max(dot(ns, v), 0.0), 3.0);
    c += vec3(0.3, 0.55, 1.0) * rim * (0.12 + 0.9 * day);
    return c;
}

// clouds are drawn in the additive pass, so they read as translucent haze
vec3 clouds() {
    vec3 ns = normalize(vW);
    float ld = dot(ns, fSun);
    float day = smoothstep(-0.15, 0.35, ld);
    float face = max(dot(ns, normalize(vView)), 0.0);
    vec3 c = vec3(0.95, 0.97, 1.0) * vCol.r * day * (0.25 + 0.3 * face);
    c += vec3(1.0, 0.5, 0.25) * vCol.r * exp(-ld * ld / 0.015) * 0.18;   // warm edge at dusk
    return c;
}

vec3 object() {
    vec3 n = faceN();
    float diff = max(dot(n, fSun), 0.0);
    // in the planet's shadow?
    float b = dot(-vW, fSun);
    if (b > 0.0 && dot(vW, vW) - b * b < PR * PR) diff = 0.0;
    vec3 c = vCol.rgb * (0.07 + diff * 1.15);
    c += vec3(0.3, 0.5, 1.0) * pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.0) * 0.18;
    if (vCol.a > 1.0) {
        float night = 1.0 - smoothstep(-0.2, 0.15, dot(normalize(vW), fSun));
        c += vec3(1.0, 0.75, 0.4) * (vCol.a - 1.0) * (0.35 + 0.65 * night);
    } else {
        c += vec3(1.0, 0.42, 0.1) * vCol.a * 1.3;
    }
    return c;
}

void main() {
    vec3 c;
    if (vMat > 2.5 && vMat < 3.5) {
        vec3 d = normalize(vDir);
        c = sky(d) + halo(d);
    } else if (vMat > 1.5 && vMat < 2.5) {
        c = planet();
    } else if (vMat > 5.5 && vMat < 6.5) {
        gl_FragColor = vec4(clouds(), 1.0);
        return;
    } else if (vMat > 3.5 && vMat < 4.5) {
        c = object();
    } else {
        gl_FragColor = vec4(vCol.rgb, 1.0);   // additive glow pass
        return;
    }
    c += vec3(0.5, 0.04, 0.06) * fFlash + vec3(0.5, 0.38, 0.12) * fNova;
    gl_FragColor = vec4(c, 1.0);
}`;
    return { VERT, FRAG };
}
