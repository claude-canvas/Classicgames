// Post-processing for Neon Velocity: the scene is drawn into an offscreen target, then
//   bright-pass → ¼-res blur (H, V) → ⅛-res blur (H, V) → composite
// The composite adds the two bloom levels, a gentle chromatic fringe, vignette, film grain,
// a warm flash (uHurt: gong strikes, fireworks) and a fade to black.
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
    // the scene's alpha is a bloom mask: emissive and additive things write it, lit surfaces don't
    vec4 s = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture2D(uTex, vUv + uTexel * vec2(1.0, -1.0))
           + texture2D(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture2D(uTex, vUv + uTexel * vec2(1.0, 1.0));
    s *= 0.25;
    gl_FragColor = vec4(s.rgb * clamp(s.a, 0.0, 1.0), 1.0);
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

const COMPOSITE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform float uTime;
uniform float uUnder;
uniform float uFade;
uniform float uHurt;
uniform float uAspect;
uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 uv = vUv;
    uv += vec2(sin(uv.y * 18.0 + uTime * 1.4), cos(uv.x * 14.0 + uTime * 1.1)) * 0.0012 * uUnder;
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    vec2 off = cc * r2 * 0.012;
    vec3 c;
    c.r = texture2D(uScene, uv + off).r;
    c.g = texture2D(uScene, uv).g;
    c.b = texture2D(uScene, uv - off).b;
    vec3 b = texture2D(uBloomA, uv).rgb * 0.75 + texture2D(uBloomB, uv).rgb * 0.85;
    c = 1.0 - (1.0 - c) * (1.0 - min(b, 1.0));                     // screen blend
    c += b * 0.15;
    float vig = smoothstep(1.05, 0.25, length(cc * vec2(uAspect, 1.0)) * (uAspect > 1.0 ? 0.95 : 1.25));
    c *= mix(0.72, 1.0, vig);
    c += vec3(0.6, 0.85, 1.0) * uHurt * 0.3;
    c += (hash(uv * uRes + fract(uTime) * 91.0) - 0.5) * 0.028;
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
            this.comp = compile(gl, VS, COMPOSITE, attrLoc);
            this.quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            this.ok = true;
        } catch (e) { console.warn("Neon Velocity: post-processing disabled", e); }
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
        for (const t of [this.scene, this.a1, this.a2, this.b1, this.b2]) this.free(t);
        this.w = w; this.h = h;
        const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
        this.scene = this.target(w, h, true);
        this.a1 = this.target(qw, qh); this.a2 = this.target(qw, qh);
        this.b1 = this.target(ew, eh); this.b2 = this.target(ew, eh);
        if (![this.scene, this.a1, this.a2, this.b1, this.b2].every((t) => t.complete)) { console.warn("Neon Velocity: framebuffer incomplete, post disabled"); this.ok = false; }
    }
    // call before drawing the scene
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
    // after the scene: run the chain and draw to the screen. Returns false if nothing was done.
    end(p) {
        if (!this.ok) return false;
        const gl = this.gl;
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
        this.pass(this.bright, this.scene, this.a1, (u) => gl.uniform2f(u.uTexel, 1 / this.w, 1 / this.h));
        this.pass(this.blur, this.a1, this.a2, (u) => gl.uniform2f(u.uDir, 1 / this.a1.w, 0));
        this.pass(this.blur, this.a2, this.a1, (u) => gl.uniform2f(u.uDir, 0, 1 / this.a1.h));
        this.pass(this.blur, this.a1, this.b1, (u) => gl.uniform2f(u.uDir, 1.5 / this.a1.w, 0));
        this.pass(this.blur, this.b1, this.b2, (u) => gl.uniform2f(u.uDir, 1.2 / this.b1.w, 0));
        this.pass(this.blur, this.b2, this.b1, (u) => gl.uniform2f(u.uDir, 0, 1.2 / this.b1.h));
        this.pass(this.comp, this.scene, null, (u) => {
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.a1.tex);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.b1.tex);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBloomA, 1); gl.uniform1i(u.uBloomB, 2);
            gl.uniform1f(u.uTime, p.time); gl.uniform1f(u.uUnder, p.under); gl.uniform1f(u.uFade, p.fade);
            gl.uniform1f(u.uHurt, p.hurt); gl.uniform1f(u.uAspect, gl.canvas.width / gl.canvas.height);
            gl.uniform2f(u.uRes, gl.canvas.width, gl.canvas.height);
        });
        gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        return true;
    }
}
