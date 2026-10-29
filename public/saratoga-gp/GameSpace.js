// Space from the projection3d library, set up for Saratoga GP (from Forest Rally):
//  - the library's buffers hold the static scene (map tiles), built once
//  - a second buffer pair holds everything that moves, rebuilt every frame
//  - camera maths (updateMyVectors, the axis vectors) and the uniform locations are Space's own
//
// Space's own reDraw() re-uploads posArr and is also triggered by its Z/Q/P key handler; here it is a no-op so
// those keys can't overwrite the static scene.

import Space from "../Space.js";

export default class GameSpace extends Space {
    constructor(gl) {
        super(gl);
        this.dynPosBuffer = gl.createBuffer();
        this.dynColBuffer = gl.createBuffer();
        this.staticCount = 0;
        // a third attribute for smooth normals: any location the base program doesn't use
        this.nrmId = [0, 1, 2, 3].find((i) => i !== this.posId && i !== this.colId);
        this.uvId = [0, 1, 2, 3, 4].find((i) => i !== this.posId && i !== this.colId && i !== this.nrmId);
        this.dynamicCount = 0;
    }

    reDraw() { }

    // camera at (x, y, z) looking at the point (tx, ty, tz)
    lookAt(x, y, z, tx, ty, tz) {
        this.Xc = x; this.Yc = y; this.Zc = z;
        this.X0 = tx; this.Y0 = ty; this.Z0 = tz;
        this.updateMyVectors();
    }

    // bank the camera: rotate the screen axes about the view direction (call after lookAt)
    roll(a) {
        const c = Math.cos(a), s = Math.sin(a), X = this.xUnitVec, Y = this.yUnitVec;
        this.xUnitVec = [X[0] * c + Y[0] * s, X[1] * c + Y[1] * s, X[2] * c + Y[2] * s];
        this.yUnitVec = [Y[0] * c - X[0] * s, Y[1] * c - X[1] * s, Y[2] * c - X[2] * s];
    }

    setStatic(pos, col, count) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, count * 4), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, col.subarray(0, count * 4), gl.STATIC_DRAW);
        this.staticCount = count;
    }

    setDynamic(pos, col, count) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynPosBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, count * 4), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynColBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, col.subarray(0, count * 4), gl.DYNAMIC_DRAW);
        this.dynamicCount = count;
    }

    // Space's camera → the current program's uniforms (locations were pointed at our program)
    applyCamera() {
        const gl = this.gl;
        gl.uniform3f(this.cPointLoc, this.Xc, this.Yc, this.Zc);
        gl.uniform3fv(this.xAxisLoc, this.xUnitVec);
        gl.uniform3fv(this.yAxisLoc, this.yUnitVec);
        gl.uniform3fv(this.zAxisLoc, this.zUnitVec);
    }

    // textured geometry: position, colour, normal and UV buffers
    bindTex(pb, cb, nb, ub) {
        const gl = this.gl;
        this.bindBuf(pb, cb, nb);
        gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.enableVertexAttribArray(this.uvId); gl.vertexAttribPointer(this.uvId, 2, gl.FLOAT, false, 0, 0);
    }
    noUV() { const gl = this.gl; gl.disableVertexAttribArray(this.uvId); gl.vertexAttrib2f(this.uvId, 0, 0); }
    noNormals() { const gl = this.gl; gl.disableVertexAttribArray(this.nrmId); gl.vertexAttrib3f(this.nrmId, 0, 0, 0); }
    bind(dynamic) {
        const gl = this.gl;
        this.noNormals();
        gl.bindBuffer(gl.ARRAY_BUFFER, dynamic ? this.dynPosBuffer : this.posBuffer);
        gl.vertexAttribPointer(this.posId, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, dynamic ? this.dynColBuffer : this.colBuffer);
        gl.vertexAttribPointer(this.colId, 4, gl.FLOAT, false, 0, 0);
    }

    // bind a chunk's own static buffers
    bindBuf(pb, cb, nb = null) {
        const gl = this.gl;
        if (nb) { gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.enableVertexAttribArray(this.nrmId); gl.vertexAttribPointer(this.nrmId, 3, gl.FLOAT, false, 0, 0); } else this.noNormals();
        gl.bindBuffer(gl.ARRAY_BUFFER, pb);
        gl.vertexAttribPointer(this.posId, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, cb);
        gl.vertexAttribPointer(this.colId, 4, gl.FLOAT, false, 0, 0);
    }

    draw(first, count) {
        if (count > 0) this.gl.drawArrays(this.gl.TRIANGLES, first, count);
    }
}
