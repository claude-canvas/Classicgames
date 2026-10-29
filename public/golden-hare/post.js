// Post-processing for Golden Hare (from The Hollow Pines / Last Light / Forest Rally): a warm morning grade, a light
// vignette and fine grain. uFear / uRed are kept (unused here: 0).
// The scene is drawn into an offscreen target whose alpha holds the depth-of-field
// circle of confusion (sky = 1.0). Then:
//   bright-pass → ¼-res blur (H, V) → ⅛-res blur (H, V)           bloom
//   ¼-res radial blur of the sky pixels toward the sun → blur        god rays through the canopy
//   composite: 12-tap golden-angle gather by CoC (bright taps weigh more → bokeh discs), bloom, rays, warm grade,
//   vignette, grain, fade.
// If the framebuffer can't be created the game draws straight to the screen (Post.ok === false).

const VS = `
attribute vec2 aP;
varying vec2 vUv;
void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

const BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
    vec3 s = vec3(0.0);
    for (int i = 0; i < 4; i++) { vec2 o = vec2(i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0); vec3 c = texture2D(uTex, vUv + uTexel * o).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); s += c * smoothstep(0.62, 0.98, l); }
    gl_FragColor = vec4(s * 0.25, 1.0);
}`;

const BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
    vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
    c += texture2D(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
    c += texture2D(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
    c += texture2D(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
    c += texture2D(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
    gl_FragColor = vec4(c, 1.0);
}`;

const RAYS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSunUV;
uniform float uAspect;
uniform float uStrength;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 d = (uSunUV - vUv) / 36.0;
    vec2 uv = vUv + d * hash(vUv * 731.0);
    float acc = 0.0, w = 1.0;
    for (int i = 0; i < 36; i++) {
        vec4 s = texture2D(uTex, uv);
        float sky = step(0.985, s.a) * smoothstep(0.55, 0.95, dot(s.rgb, vec3(0.3, 0.55, 0.15)));
        acc += sky * w; w *= 0.968; uv += d;
    }
    vec2 dd = (vUv - uSunUV) * vec2(uAspect, 1.0);
    float fall = 1.0 / (1.0 + dot(dd, dd) * 3.0);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * acc / 36.0 * uStrength * fall, 1.0);
}`;

const COMPOSITE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform sampler2D uRays;
uniform float uTime;
uniform float uFade;
uniform float uFlash;
uniform float uAspect;
uniform float uMaxR;
uniform float uSkyCoc;
uniform vec2 uRes;
uniform float uFear;
uniform float uRed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
    vec2 uv = vUv;
    // fear: horizontal tears that jitter, stronger toward the edges
    float edge = length((uv - 0.5) * vec2(uAspect, 1.0));
    float band = step(0.93, hash(vec2(floor(uv.y * 90.0), floor(uTime * 14.0))));
    uv.x += (hash(vec2(floor(uv.y * 240.0), floor(uTime * 30.0))) - 0.5) * 0.02 * uFear * band * (0.4 + edge);
    vec4 c0 = texture2D(uScene, uv);
    float coc = c0.a > 0.985 ? uSkyCoc : c0.a;
    float rad = coc * uMaxR;
    vec3 c = c0.rgb;
    if (rad > 0.7) {
        vec3 acc = c0.rgb; float ws = 1.0;
        float rot = hash(uv * uRes) * 6.2831;
        for (int i = 0; i < 12; i++) {
            float fi = float(i) + 0.5;
            float r = sqrt(fi / 12.0) * rad, th = fi * 2.39996 + rot;
            vec4 s = texture2D(uScene, uv + vec2(cos(th), sin(th)) * r / uRes);
            float sc = (s.a > 0.985 ? uSkyCoc : s.a) * uMaxR;
            float w = clamp(sc - r + 1.0, 0.0, 1.0) * (1.0 + 7.0 * pow(lum(s.rgb), 5.0));
            acc += s.rgb * w; ws += w;
        }
        c = acc / ws;
    }
    // colour fringing
    if (uFear > 0.01) { vec2 off = (uv - 0.5) * 0.012 * uFear * (1.0 + edge); c.r = mix(c.r, texture2D(uScene, uv + off).r, 0.8); c.b = mix(c.b, texture2D(uScene, uv - off).b, 0.8); }
    vec3 b = texture2D(uBloomA, uv).rgb * 0.45 + texture2D(uBloomB, uv).rgb * 0.6;
    c = 1.0 - (1.0 - c) * (1.0 - min(b, 1.0));
    c += texture2D(uRays, uv).rgb;
    // a warm, golden morning grade
    float l = lum(c);
    c = mix(c, c * vec3(1.05, 1.0, 0.92), 0.55);
    c = mix(vec3(l), c, 1.08);
    c = c * c * (3.0 - 2.0 * c) * 0.25 + c * 0.75;
    vec2 cc = uv - 0.5;
    float vig = smoothstep(1.05, 0.2, length(cc * vec2(uAspect, 1.0)) * (uAspect > 1.0 ? 0.92 : 1.2));
    c *= mix(0.62, 1.0, vig);
    // night: a heavier vignette that closes in with fear; colour drains toward cold grey
    c *= mix(1.0, smoothstep(1.05, 0.25, edge), 0.22);
    c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))) * vec3(0.85, 0.95, 1.05), uFear * 0.6);
    c = mix(c, vec3(0.9, 0.05, 0.03) * (0.5 + dot(c, vec3(0.6))), uRed);
    c += vec3(1.0, 0.9, 0.7) * uFlash * 0.25;
    c += (hash(uv * uRes + fract(uTime) * 91.0) - 0.5) * 0.022;
    gl_FragColor = vec4(c * uFade, 1.0);
}`;

function compile(gl, vs, fs, attrLoc) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, attrLoc, "aP");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
}

export class Post {
    constructor(gl, attrLoc) {
        this.gl = gl; this.attr = attrLoc; this.ok = false; this.w = 0; this.h = 0;
        try {
            this.bright = compile(gl, VS, BRIGHT, attrLoc);
            this.blur = compile(gl, VS, BLUR, attrLoc);
            this.rays = compile(gl, VS, RAYS, attrLoc);
            this.comp = compile(gl, VS, COMPOSITE, attrLoc);
            this.quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            this.ok = true;
        } catch (e) { console.warn("Last Light: post-processing disabled", e); }
    }
    target(w, h, depth) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        let rb = null;
        if (depth) {
            rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
        }
        const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fb, rb, w, h, complete };
    }
    free(t) { if (!t) return; const gl = this.gl; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); }
    resize(w, h) {
        if (!this.ok || (w === this.w && h === this.h)) return;
        for (const t of [this.scene, this.a1, this.a2, this.b1, this.b2, this.r1, this.r2]) this.free(t);
        this.w = w; this.h = h; this.raysClear = false;
        const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
        this.scene = this.target(w, h, true);
        this.a1 = this.target(qw, qh); this.a2 = this.target(qw, qh);
        this.b1 = this.target(ew, eh); this.b2 = this.target(ew, eh);
        this.r1 = this.target(qw, qh); this.r2 = this.target(qw, qh);
        if (![this.scene, this.a1, this.a2, this.b1, this.b2, this.r1, this.r2].every((t) => t.complete)) { console.warn("Last Light: framebuffer incomplete, post disabled"); this.ok = false; }
    }
    begin() {
        const gl = this.gl;
        if (!this.ok) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.canvas.width, gl.canvas.height); return; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
        gl.viewport(0, 0, this.w, this.h);
    }
    pass(prog, src, dst, setup) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
        gl.viewport(0, 0, dst ? dst.w : gl.canvas.width, dst ? dst.h : gl.canvas.height);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        if (prog.u.uTex) gl.uniform1i(prog.u.uTex, 0);
        if (setup) setup(prog.u);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.vertexAttribPointer(this.attr, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // p: { time, fade, flash, sunUV:[u,v], sunK, maxR, skyCoc }
    end(p) {
        if (!this.ok) return false;
        const gl = this.gl, asp = gl.canvas.width / gl.canvas.height;
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
        this.pass(this.bright, this.scene, this.a1, (u) => gl.uniform2f(u.uTexel, 1 / this.w, 1 / this.h));
        this.pass(this.blur, this.a1, this.a2, (u) => gl.uniform2f(u.uDir, 1 / this.a1.w, 0));
        this.pass(this.blur, this.a2, this.a1, (u) => gl.uniform2f(u.uDir, 0, 1 / this.a1.h));
        this.pass(this.blur, this.a1, this.b1, (u) => gl.uniform2f(u.uDir, 1.5 / this.a1.w, 0));
        this.pass(this.blur, this.b1, this.b2, (u) => gl.uniform2f(u.uDir, 1.2 / this.b1.w, 0));
        this.pass(this.blur, this.b2, this.b1, (u) => gl.uniform2f(u.uDir, 0, 1.2 / this.b1.h));
        // god rays: skipped entirely while the sun term is off (the rays target is cleared to black once)
        if (p.sunK > 0) {
            this.pass(this.rays, this.scene, this.r1, (u) => { gl.uniform2f(u.uSunUV, p.sunUV[0], p.sunUV[1]); gl.uniform1f(u.uAspect, asp); gl.uniform1f(u.uStrength, p.sunK); });
            this.pass(this.blur, this.r1, this.r2, (u) => gl.uniform2f(u.uDir, 1 / this.r1.w, 0));
            this.pass(this.blur, this.r2, this.r1, (u) => gl.uniform2f(u.uDir, 0, 1 / this.r1.h));
            this.raysClear = false;
        } else if (!this.raysClear) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.r1.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); this.raysClear = true;
        }
        this.pass(this.comp, this.scene, null, (u) => {
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.a1.tex);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.b1.tex);
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.r1.tex);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBloomA, 1); gl.uniform1i(u.uBloomB, 2); gl.uniform1i(u.uRays, 3);
            gl.uniform1f(u.uTime, p.time); gl.uniform1f(u.uFade, p.fade); gl.uniform1f(u.uFlash, p.flash);
            gl.uniform1f(u.uAspect, asp); gl.uniform1f(u.uMaxR, p.maxR); gl.uniform1f(u.uSkyCoc, p.skyCoc);
            gl.uniform2f(u.uRes, gl.canvas.width, gl.canvas.height);
            gl.uniform1f(u.uFear, p.fear || 0); gl.uniform1f(u.uRed, p.red || 0);
        });
        gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        return true;
    }
}
