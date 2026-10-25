/**
 * The abbey's flagstone floor, shared by every shader that draws the ground of the intro (the dungeon floor round the
 * gate and the floor the AWAKEN pool opens in), so the stones line up wherever the camera cuts. Big slabs laid in
 * courses of uneven depth across the nave, each slab its own tone and polish, joints worn and never ruled straight,
 * cracks through some slabs. Everything is in world metres on xz. Each set of joints fades out once it gets thinner
 * than a pixel or two, so the far floor (and the courses seen edge-on from a low camera) never reads as stripes or
 * shimmers. Needs `uniform sampler2D uNoise` (the shared noise texture) declared before it.
 */
export const PAVING_GLSL = /* glsl */ `
struct Paving {
  float joint; // 1 in a joint between slabs
  float crack; // 1 in a crack through a slab
  float id;    // 0..1, one value per slab (tone, polish, tilt)
  vec2 rel;    // position inside the slab, -0.5..0.5 each way
  float detail; // 0 where the slabs are too small on screen to draw their joints
};
float pvHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
Paving paving(vec2 p) {
  Paving s;
  // worn joints wander a few centimetres
  vec2 w = p + (vec2(texture2D(uNoise, p * 0.07).r, texture2D(uNoise, p * 0.07 + 0.5).g) - 0.5) * 0.14;
  // courses in pairs 2.3 m deep, each pair split unevenly, so no two neighbouring courses match
  const float PAIR = 2.3;
  float pair = floor(w.y / PAIR);
  float py = w.y - pair * PAIR;
  float split = PAIR * mix(0.36, 0.64, pvHash(vec2(pair, 9.2)));
  float upper = step(split, py);
  float row = pair * 2.0 + upper;
  float rh = mix(split, PAIR - split, upper);
  float fy = py - upper * split;
  float sw = mix(0.95, 1.9, pvHash(vec2(row, 1.7)));
  float u = w.x / sw + pvHash(vec2(row, 4.3));
  float col = floor(u);
  float fx = fract(u) * sw;
  float ex = min(fx, sw - fx), ey = min(fy, rh - fy);
  vec2 fw = max(fwidth(p), vec2(1e-4));
  // a set of joints draws only while it is wider than about a pixel on screen
  float dx = 1.0 - smoothstep(0.02, 0.07, fw.x), dy = 1.0 - smoothstep(0.02, 0.07, fw.y);
  s.detail = min(dx, dy);
  // chipped arrises: the joint opens up where a corner has worn away
  float chip = texture2D(uNoise, p * 0.9 + 0.17).r;
  float jw = 0.018 + 0.03 * chip * chip;
  float jx = 1.0 - smoothstep(jw, jw + 0.025 + fw.x, ex);
  float jy = 1.0 - smoothstep(jw, jw + 0.025 + fw.y, ey);
  s.joint = max(jx * dx, jy * dy);
  s.id = pvHash(vec2(row, col) + 0.37);
  s.rel = vec2(fx / sw, fy / rh) - 0.5;
  float cr = texture2D(uNoise, p * 0.085 + s.id * 3.1).b;
  s.crack = smoothstep(0.84, 0.92, cr) * step(0.45, s.id) * s.detail;
  return s;
}
`;
