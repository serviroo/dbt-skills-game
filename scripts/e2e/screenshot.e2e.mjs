// A screenshot taken while the GPU is still working through what a page drew waits for that drawing, not on the
// capture's own time, and shows the last thing the page drew. WebGL drawing leaves the page's script free, so only a
// wait on the GPU's queue itself covers it.
import sharp from 'sharp';

// GPU work queued before the shot, and the time the capture itself gets (this page alone captures in under 40 ms), in ms
const QUEUED = 800;
const CAPTURE = 300;

export const scenarios = {
  async 'screenshot-after-queued-drawing'(h) {
    const ctx = await h.browser.newContext({ viewport: { width: 400, height: 300 } });
    try {
      const page = await ctx.newPage();
      await page.setContent('<canvas width="512" height="512" style="position:fixed;left:0;top:0;width:400px;height:300px"></canvas><canvas width="100" height="100" style="position:fixed;right:0;top:0;width:100px;height:100px"></canvas>');
      const queued = await page.evaluate((queued) => {
        const [c3, c2] = document.querySelectorAll('canvas');
        const gl = c3.getContext('webgl2');
        const shader = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main() { gl_Position = vec4(a, 0, 1); }'));
        gl.attachShader(p, shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; uniform int n; out vec4 o; void main() { float s = 0.; for (int i = 0; i < n; i++) s = fract(s * 1.7 + sin(gl_FragCoord.x * .01 + float(i))); o = vec4(s, .3, .6, 1); }'));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('the busy shader did not link: ' + gl.getProgramInfoLog(p));
        gl.useProgram(p);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const n = gl.getUniformLocation(p, 'n');
        // each draw is sent on its own and lasts tens of ms: a driver resets a GPU that is stuck on one job for about 2 s
        const draw = (loops, times) => {
          for (let i = 0; i < times; i++) {
            gl.uniform1i(n, loops);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.flush();
          }
        };
        const timed = (loops, times) => {
          const t = performance.now();
          draw(loops, times);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          return performance.now() - t;
        };
        let loops = 16;
        while (timed((loops *= 2), 1) < 20);
        const each = timed(loops, 10) / 10;
        // in a frame, as a page draws: the busy draws, then a magenta corner on the WebGL canvas and green on the 2D one
        return new Promise((done) => requestAnimationFrame(() => {
          const draws = Math.ceil(queued / each);
          draw(loops, draws);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(0, 0, 64, 64);
          gl.clearColor(1, 0, 1, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const g = c2.getContext('2d');
          g.fillStyle = '#0f0';
          g.fillRect(0, 0, 100, 100);
          done({ draws, each: Math.round(each) });
        }));
      }, QUEUED);
      page.setDefaultTimeout(CAPTURE);
      const t = Date.now();
      const { data, info } = await sharp(await h.shot(page, 'screenshot-after-queued-drawing')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const took = Date.now() - t;
      const at = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
      const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= 8);
      h.expect(took > CAPTURE, `the GPU had finished before the shot (${took} ms with ${JSON.stringify(queued)}), so this proves nothing`);
      h.expect(near(at(20, 290), [255, 0, 255]), `the shot is missing the WebGL canvas's last drawing: ${at(20, 290)}`);
      h.expect(near(at(350, 50), [0, 255, 0]), `the shot is missing the 2D canvas's last drawing: ${at(350, 50)}`);
      return { took, ...queued };
    } finally {
      await ctx.close();
    }
  },
};
