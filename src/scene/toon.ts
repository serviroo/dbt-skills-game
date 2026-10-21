import * as THREE from 'three';

/** Lighting shared by every toon material in the scene. Mutate the values, never replace the objects. */
export const light = {
  uKeyDir: { value: new THREE.Vector3(-0.35, 0.55, 0.75).normalize() },
  uKeyColor: { value: new THREE.Color(0x9fb4d8) },
  uKeyStrength: { value: 0.35 },
  uRimDir: { value: new THREE.Vector3(0.0, 0.25, -1.0).normalize() },
  uRimColor: { value: new THREE.Color(0x4fb8ff) },
  uRimColor2: { value: new THREE.Color(0x7b3fe4) },
  uRimStrength: { value: 2.2 },
  uAmbTop: { value: new THREE.Color(0x1a2240) },
  uAmbBottom: { value: new THREE.Color(0x140c2a) },
  uFogColor: { value: new THREE.Color(0x07080f) },
  uFogDensity: { value: 0.035 },
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector3(0.25, 0.05, 1.0).normalize() },
  uWind: { value: 1.0 },
  uGroundGlow: { value: new THREE.Color(0x2a1660) },
  uGroundGlowStrength: { value: 0.0 },
};

export const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.02 + 17.1; a *= 0.5; }
  return s;
}
`;

const VERT_COMMON = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWind;
uniform float uFlutterAmp;
uniform float uSwayAmp;
uniform float uFlare;
uniform float uFlareBack;
uniform float uAnimFps;
attribute float aFlutter;
attribute float aSway;
${NOISE_GLSL}

vec3 windOffset(vec3 wp, float flutter, float sway) {
  vec3 off = vec3(0.0);
  // secondary motion on 2s when uAnimFps > 0: the cloth and hair hold each pose for a few frames, as a drawn cut would
  float tA = uAnimFps > 0.0 ? floor(uTime * uAnimFps) / uAnimFps : uTime;
  if (flutter > 0.0) {
    float t = tA;
    float ph = wp.x * 3.1 + wp.z * 2.3;
    float w1 = sin(t * 2.3 + ph + wp.y * 4.0);
    float w2 = sin(t * 3.7 + ph * 1.7 - wp.y * 6.0) * 0.5;
    float n = fbm3(vec3(wp.x * 2.0, wp.y * 1.5 - t * 1.2, wp.z * 2.0 + t * 0.6)) - 0.5;
    float a = flutter * flutter * uFlutterAmp * uWind;
    off += uWindDir * a * (0.55 + 0.35 * w1 + 0.25 * w2 + n * 0.9);
    off.y += a * 0.25 * (w2 + n);
    vec3 side = normalize(cross(uWindDir, vec3(0.0, 1.0, 0.0)));
    off += side * a * 0.35 * (w1 * 0.6 + n);
  }
  if (sway > 0.0) {
    float t = tA;
    float s = sway * sway * uSwayAmp * uWind;
    off += uWindDir * s * (0.6 + 0.4 * sin(t * 1.7 + wp.x * 9.0 + wp.y * 7.0));
    off.x += s * 0.4 * sin(t * 2.3 + wp.z * 11.0);
  }
  return off;
}
`;

const SKIN_BEGIN = /* glsl */ `
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
  vec3 wn = mat3(modelMatrix) * objectNormal;
  float wnl = length(wn);
  wn = wnl > 1e-6 ? wn / wnl : vec3(0.0, 1.0, 0.0);
  wp4.xyz += windOffset(wp4.xyz, aFlutter, aSway);
  #ifdef USE_SKINNING
  if (uFlare > 0.0 && aFlutter > 0.0) {
    vec3 fd = vec3(position.x, 0.0, position.z);
    float fdl = length(fd);
    fd = fdl > 1e-4 ? fd / fdl : vec3(0.0, 0.0, -1.0);
    fd = normalize(fd + vec3(0.0, 0.0, -uFlareBack));
    fd = mat3(modelMatrix) * (mat3(skinMatrix) * fd);
    float ff = aFlutter * aFlutter;
    float fph = position.x * 4.0 + position.z * 2.5;
    float tF = uAnimFps > 0.0 ? floor(uTime * uAnimFps) / uAnimFps : uTime;
    float swing = 0.62 + 0.24 * sin(tF * 1.2 + fph) + 0.14 * sin(tF * 2.6 + fph * 1.7 + position.y * 6.0);
    wp4.xyz += fd * (uFlare * ff * swing * uWind);
    wp4.y += uFlare * ff * swing * uWind * 0.22;
  }
  #endif
`;

const toonVert = /* glsl */ `
${VERT_COMMON}
#ifdef HAIR
attribute vec3 aTangent;
varying vec3 vTangentW;
#endif
#ifdef HEM
attribute float aHem;
varying float vHem;
#endif
#ifdef HAIR_SHEEN
attribute vec3 aStrand;
varying vec3 vStrand;
#endif
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObjPos;
varying float vFlutter;
void main() {
  ${SKIN_BEGIN}
  vNormalW = wn;
  vPosW = wp4.xyz;
  vObjPos = position;
  vFlutter = aFlutter;
  #ifdef HAIR
  vTangentW = normalize(mat3(modelMatrix) * aTangent);
  #endif
  #ifdef HAIR_SHEEN
  vStrand = aStrand;
  #endif
  #ifdef HEM
  vHem = aHem;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp4;
}
`;

const toonFrag = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uKeyStrength;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uRimColor2;
uniform float uRimStrength;
uniform float uRimMat;
uniform float uRimWidth;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTerm;
uniform float uSoft;
uniform vec3 uEmissive;
uniform float uSpec;
uniform vec3 uSpecColor;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uClipY;
uniform vec3 uClipColor;
uniform float uBackShade;
uniform float uTime;
uniform vec3 uGroundGlow;
uniform float uGroundGlowStrength;
uniform float uOpacity;
uniform vec3 uRimTint;
uniform vec3 uHemColor;
uniform float uHemGlow;
uniform float uHemStart;
uniform float uFaceShadowY;
uniform float uKeyMul;
uniform float uRimUpCut;
uniform float uFaceShadowDark;
uniform float uRimWrap;
uniform vec4 uCastV;
uniform vec3 uHairC;
uniform vec3 uHairR;
uniform float uRingEl;
uniform float uRingW;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObjPos;
varying float vFlutter;
#ifdef HAIR
varying vec3 vTangentW;
#ifndef HAIR_DEPTH
#define HAIR_DEPTH 0.78
#endif
#endif
#ifdef HEM
varying float vHem;
#endif
#ifdef INK_STROKES
uniform vec4 uStrokeA[INK_STROKES];
uniform vec4 uStrokeB[INK_STROKES];
uniform vec4 uStrokeSpace;
uniform vec3 uInkColor;
uniform vec3 uSheenColor;
#endif
#ifdef OCCLUDE
uniform vec4 uOcclA;
uniform vec4 uOcclB;
#endif
#ifdef KEY_BIAS
uniform vec3 uKeyBias;
#endif
#ifdef KEY_FAR
uniform vec3 uKeyFar;
#endif
#ifdef CAST_CURVE
uniform vec3 uCastCurve;
#endif
#ifdef RIM_FAR
uniform vec3 uRimFar;
#endif
#ifdef RIM_LOW
uniform vec3 uRimLow;
#endif
#ifdef FACE_MASK
uniform vec3 uFaceMask[FACE_MASK];
uniform float uFaceMaskRise;
#endif
#ifdef FACE_MASK_SLOPE
uniform float uFaceMaskSlope;
#endif
#ifdef FAR_DIM
uniform vec4 uFarDim;
#endif
#ifdef EMISSIVE_FAR
uniform vec3 uEmissiveFar;
#endif
#ifdef SHADE_NORMAL
uniform mat4 modelMatrix;
uniform vec3 uShadeC;
uniform vec3 uShadeR;
uniform float uShadeBlend;
#endif
#ifdef HAIR_SHEEN
uniform vec4 uHairSheenA;
uniform vec4 uHairSheenB;
uniform vec3 uHairSheen;
varying vec3 vStrand;
#endif
${NOISE_GLSL}

void main() {
  float clipEdge = 0.0;
  if (uClipY > -50.0) {
    float d = vPosW.y - uClipY;
    if (d < 0.0) discard;
    clipEdge = 1.0 - smoothstep(0.0, 0.06, d);
  }
  float dissolveEdge = 0.0;
  if (uDissolve > 0.0) {
    float n = fbm3(vObjPos * 7.0 + vec3(0.0, uTime * 0.2, 0.0));
    float h = n + (vObjPos.y * 0.15);
    float th = uDissolve * 1.25 - 0.1;
    if (h < th) discard;
    dissolveEdge = 1.0 - smoothstep(0.0, 0.05, h - th);
  }

  vec3 N = vNormalW;
  float nlen = length(N);
  N = nlen > 1e-6 ? N / nlen : vec3(0.0, 1.0, 0.0);
  bool back = !gl_FrontFacing;
  if (back) N = -N;
  vec3 V = normalize(cameraPosition - vPosW);

  vec3 NL = N;
  #ifdef SHADE_NORMAL
  {
    // the key reads a simplified form (an ellipsoid around the head) so the cel shadow falls in one clean shape
    vec3 q = (vObjPos - uShadeC) / (uShadeR * uShadeR);
    vec3 sn = mat3(modelMatrix) * q;
    float snl = length(sn);
    if (snl > 1e-6) NL = normalize(mix(N, sn / snl, uShadeBlend));
  }
  #endif
  #ifdef KEY_BIAS
  // a per-material turn of the key (a face lit more from the front than the body, as an animator would paint it)
  float ndl = dot(NL, normalize(uKeyDir + uKeyBias));
  #else
  float ndl = dot(NL, uKeyDir);
  #endif
  float lit = smoothstep(uTerm - uSoft, uTerm + uSoft, ndl);
  #ifdef KEY_FAR
  // the key fades with camera distance: lit in the inserts, in the figure's shadow in the wide shots
  lit *= mix(1.0, uKeyFar.z, smoothstep(uKeyFar.x, uKeyFar.y, length(cameraPosition - vPosW)));
  #endif
  float faceSh = 0.0;
  if (uFaceShadowY > -50.0) {
    #if defined(FACE_MASK)
    // the fringe's shadow as a drawn mask: a band over the eyes whose edge rises toward the temples (so the cheeks
    // stay one clean tone in a 3/4 view) with one pointed tongue under each fringe lock: [x, depth, half width]
    float jag = -uFaceMaskRise * vObjPos.x * vObjPos.x;
    for (int i = 0; i < FACE_MASK; i++) {
      vec3 tg = uFaceMask[i];
      jag += tg.y * pow(max(0.0, 1.0 - abs(vObjPos.x - tg.x) / tg.z), 1.6);
    }
    #ifdef FACE_MASK_SLOPE
    // the band runs on a diagonal: lower on one side of the face (down over that cheek), higher on the other
    jag -= uFaceMaskSlope * vObjPos.x;
    #endif
    #elif defined(FACE_TONGUES)
    // the fringe's shadow: a few pointed tongues hanging down from the band, like the locks that throw it
    float jag = 0.013 * pow(1.0 - abs(sin(vObjPos.x * 72.0 + 0.6)), 2.5) + 0.003 * sin(vObjPos.x * 190.0 + 1.3) - 0.002;
    #else
    float jag = 0.006 * sin(vObjPos.x * 260.0) + 0.004 * sin(vObjPos.x * 610.0 + 1.3);
    #endif
    float fs = smoothstep(uFaceShadowY - 0.004, uFaceShadowY + 0.004, vObjPos.y + jag) * smoothstep(-0.02, 0.03, vObjPos.z);
    lit *= 1.0 - fs;
    faceSh = fs;
  }
  float castSh = 0.0;
  if (uCastV.w > 0.0) {
    #ifdef CAST_CURVE
    // a rounded edge (the soft U a neckline's shadow makes) with a slight cloth wobble, instead of the straight V
    float edge = vObjPos.y - (uCastV.x + uCastV.y * abs(vObjPos.x) + uCastCurve.x * vObjPos.x * vObjPos.x + uCastCurve.y * sin(vObjPos.x * uCastCurve.z + 0.7));
    #else
    float edge = vObjPos.y - (uCastV.x + uCastV.y * abs(vObjPos.x));
    #endif
    float aa = max(fwidth(edge), 1e-4);
    castSh = smoothstep(-aa, aa, edge) * step(uCastV.z, vObjPos.z);
    lit *= 1.0 - castSh;
  }
  #ifdef OCCLUDE
  // a garment's open edges throw a hard shadow onto what they cover: object-space angle band, per side
  float occSh = 0.0;
  {
    float oy = vObjPos.y - uOcclA.w;
    float halfA = uOcclA.x + uOcclA.y * oy + uOcclA.z * oy * oy;
    float phi = atan(vObjPos.x, vObjPos.z - uOcclB.w);
    float jag = 0.04 * sin(vObjPos.y * 21.0 + 1.3) + 0.015 * sin(vObjPos.y * 57.0);
    float e = max(-phi - (halfA - uOcclB.x), phi - (halfA - uOcclB.y)) + jag;
    float aa = max(fwidth(e), 1e-4);
    occSh = smoothstep(-aa, aa, e);
    lit *= 1.0 - occSh;
  }
  #endif
  vec3 litCol = uBase * mix(vec3(1.0), uKeyColor * 1.6, 0.5);
  #ifdef KEY_CLAMP
  // the lit tone is a fixed paint colour: a weak cutscene key is boosted to it, a strong lab key never overshoots it
  vec3 col = mix(uShade, litCol, min(lit * uKeyStrength * uKeyMul, 1.0));
  #else
  vec3 col = mix(uShade, litCol, lit * uKeyStrength * uKeyMul);
  #endif
  #ifdef FAR_DIM
  // the shadow tone dims with camera distance: a readable skin shadow in the inserts, a deeper one in the wide shots
  col *= mix(1.0, uFarDim.z, smoothstep(uFarDim.x, uFarDim.y, length(cameraPosition - vPosW)));
  #endif
  col *= 1.0 - faceSh * uFaceShadowDark;
  col *= 1.0 - castSh * uCastV.w;
  #ifdef OCCLUDE
  col *= 1.0 - occSh * uOcclB.z;
  #endif

  float hemi = N.y * 0.5 + 0.5;
  col += mix(uAmbBottom, uAmbTop, hemi) * 0.35;
  #ifdef GROUND_MUL
  col += uGroundGlow * uGroundGlowStrength * GROUND_MUL * smoothstep(0.2, -0.8, N.y) * (1.0 - smoothstep(0.0, 1.6, vPosW.y));
  #else
  col += uGroundGlow * uGroundGlowStrength * smoothstep(0.2, -0.8, N.y) * (1.0 - smoothstep(0.0, 1.6, vPosW.y));
  #endif

  #ifdef HAIR
  {
    vec3 hp = vObjPos - uHairC;
    float q = length(hp / uHairR);
    // layered depth: hair close to the scalp (between clumps) sits in its own shadow
    col *= mix(HAIR_DEPTH, 1.0, smoothstep(1.02, 1.14, q));
    #ifdef HAIR_LINES
    // strand separation: each lock goes dark where it turns away at its edges, so neighbouring locks read as drawn shapes
    {
      float nv = dot(N, V);
      float aaL = max(fwidth(nv), 1e-3);
      col *= 1.0 - HAIR_LINES * (1.0 - smoothstep(0.24 - aaL, 0.24 + aaL, nv));
    }
    #endif
    float sEl = hp.y / max(length(hp), 1e-4);
    float az = atan(hp.x, hp.z);
    // the ring is broken into tapered dashes, one per clump, with teeth pointing down the strands
    float sa = az * (14.0 / 6.2831853) + 0.3 * sin(az * 3.0 + 1.1);
    float cell = floor(sa);
    float fs = fract(sa);
    float rnd = hash13(vec3(cell, 7.0, 3.0));
    float len = mix(0.72, 0.95, rnd);
    float u = clamp(fs / len, 0.0, 1.0);
    float taper = fs < len ? pow(sin(3.14159 * u), 0.7) : 0.0;
    float tooth = abs(fract(sa * 5.0 + rnd) - 0.5) * 2.0;
    float c0 = uRingEl + 0.05 * (rnd - 0.5) + 0.02 * sin(az * 2.0 + 0.4);
    float w = uRingW * taper;
    float d = sEl - c0;
    float aa = max(fwidth(sEl), 1e-4);
    float upper = 1.0 - smoothstep(w * 0.55 - aa, w * 0.55 + aa, d);
    float lower = smoothstep(-w * (1.0 + 0.7 * tooth) - aa, -w * (1.0 + 0.7 * tooth) + aa, d);
    float ring = upper * lower * step(0.001, w);
    float facingCam = smoothstep(0.4, 0.75, dot(N, V));
    float towardLight = smoothstep(-0.1, 0.5, dot(N, uKeyDir));
    // only where the hair surface turns over the crown, never on the hanging fringe
    float crown = smoothstep(0.05, 0.35, N.y);
    col += uSpecColor * uSpec * ring * facingCam * towardLight * crown;
    #ifdef HAIR_SHEEN
    {
      // each marked lock carries its own sliver of sheen where it turns over the forehead: blunt toward the root,
      // drawn out to a point down the strand, set off the lock's centre line (strand coords: along, across, lock id)
      float hid = vStrand.z;
      float hc = uHairSheenA.x + uHairSheenA.y * (fract(hid * 13.7) - 0.5);
      float hl = uHairSheenA.z * (0.75 + 0.5 * fract(hid * 7.31));
      float hu = (vStrand.x - hc) / hl;
      hu = hu < 0.0 ? hu * 2.2 : hu;
      float hw = uHairSheenA.w * (hu < 0.0 ? sqrt(max(0.0, 1.0 - hu * hu)) : pow(max(0.0, 1.0 - hu), 1.7));
      float hd = abs(vStrand.y - 0.3 * (fract(hid * 3.91) - 0.5));
      float haa = max(fwidth(vStrand.y), 1e-3);
      float hb = (1.0 - smoothstep(hw - haa, hw + haa, hd)) * step(1e-3, hid) * step(abs(hu), 1.0) * step(1e-4, hw);
      float hcam = smoothstep(0.2, 0.55, dot(N, V));
      float hkey = mix(uHairSheenB.x, 1.0, smoothstep(-0.2, 0.6, dot(N, uKeyDir)));
      col += uHairSheen * hb * hcam * hkey;
    }
    #endif
  }
  #endif

  float fres = 1.0 - max(dot(N, V), 0.0);
  float facing = dot(N, uRimDir);
  float rimMask = smoothstep(uRimWidth, uRimWidth + 0.06, fres) * smoothstep(-0.15 - uRimWrap, 0.35 - uRimWrap, facing);
  rimMask *= 1.0 - uRimUpCut * smoothstep(0.3, 0.8, N.y);
  vec3 rimCol = mix(uRimColor2, uRimColor, smoothstep(-0.2, 0.6, N.y + facing * 0.3));
  #ifdef RIM_FAR
  // far away, thin forms turn the rim into a dotted line: thin it out and dim it with camera distance
  {
    float rf = smoothstep(uRimFar.x, uRimFar.y, length(cameraPosition - vPosW));
    rimMask *= mix(1.0, uRimFar.z, rf) * (1.0 - rf * (1.0 - smoothstep(uRimWidth + 0.06, uRimWidth + 0.2, fres)));
  }
  #endif
  #ifdef RIM_LOW
  // the backlight dies off toward the floor: the lower cloth keeps only a fraction of the rim
  rimMask *= mix(uRimLow.z, 1.0, smoothstep(uRimLow.y, uRimLow.x, vPosW.y));
  #endif
  col += rimCol * uRimTint * rimMask * uRimStrength * uRimMat;
  #ifdef HEM
  float hem = vHem;
  #else
  float hem = smoothstep(uHemStart, 1.0, vFlutter);
  #endif
  col = mix(col, uHemColor, hem * 0.6);
  col += uHemColor * uHemGlow * pow(hem, 3.0);

  #ifdef INK_STROKES
  {
    // drawn fold and seam lines on cloth, in the cloth's own cylinder coordinates (object space, so they ride the skin)
    vec2 q = vec2(vObjPos.x - uStrokeSpace.w, vObjPos.z - uStrokeSpace.y);
    float th = atan(q.y / uStrokeSpace.x, q.x);
    if (th < uStrokeSpace.z) th += 6.2831853;
    float rad = length(q);
    // derivatives once, in uniform control flow (the stroke loop below is masked, never branched)
    float aa = max(min(fwidth(th), 0.2) * rad, 1e-5);
    float ink = 0.0, sheen = 0.0;
    for (int i = 0; i < INK_STROKES; i++) {
      vec4 a = uStrokeA[i];
      vec4 b = uStrokeB[i];
      float s = clamp((a.x - vObjPos.y) / (a.x - a.y), 0.0, 1.0);
      float c = mix(a.z, a.w, s) + b.x * 4.0 * s * (1.0 - s);
      float d = (th - c) * rad;
      float w = b.y * pow(4.0 * s * (1.0 - s), b.w);
      float on = abs(b.z) * step(0.0001, w);
      ink = max(ink, (1.0 - smoothstep(w - aa, w + aa, abs(d))) * on);
      float sd = abs(d - sign(b.z) * (w + 2.0 * aa + 0.004));
      sheen = max(sheen, (1.0 - smoothstep(w * 0.5, w * 0.5 + aa, sd)) * on);
    }
    col = mix(col, uInkColor, ink);
    col += uSheenColor * sheen * (1.0 - ink);
  }
  #endif

  if (back) col *= uBackShade;

  #ifdef EMISSIVE_FAR
  // hairline emissive trims fade with distance instead of breaking into sub-pixel dashes in the wide shots
  col += uEmissive * mix(1.0, uEmissiveFar.z, smoothstep(uEmissiveFar.x, uEmissiveFar.y, length(cameraPosition - vPosW)));
  #else
  col += uEmissive;
  #endif
  col += uDissolveColor * dissolveEdge * 3.0;
  col += uClipColor * clipEdge * 2.5;

  float dist = length(cameraPosition - vPosW);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = max(col, vec3(0.0));
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(60.0)), uOpacity);
}
`;

const outlineVert = /* glsl */ `
${VERT_COMMON}
uniform float uOutlinePx;
uniform vec2 uResolution;
uniform float uRefDist;
varying vec3 vPosW;
varying vec3 vObjPos;
void main() {
  ${SKIN_BEGIN}
  vPosW = wp4.xyz;
  vObjPos = position;
  vec4 clip = projectionMatrix * viewMatrix * wp4;
  vec3 cn = mat3(projectionMatrix) * (mat3(viewMatrix) * wn);
  vec2 dir = cn.xy;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(0.0);
  float dist = clip.w;
  float scale = clamp(uRefDist / max(dist, 0.001), 0.45, 1.6);
  clip.xy += dir * uOutlinePx * scale * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

const outlineFrag = /* glsl */ `
uniform vec3 uOutlineColor;
uniform float uClipY;
uniform float uDissolve;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOpacity;
varying vec3 vPosW;
varying vec3 vObjPos;
${NOISE_GLSL}
void main() {
  if (uClipY > -50.0 && vPosW.y < uClipY) discard;
  if (uDissolve > 0.0) {
    float n = fbm3(vObjPos * 7.0 + vec3(0.0, uTime * 0.2, 0.0));
    float h = n + (vObjPos.y * 0.15);
    if (h < uDissolve * 1.25 - 0.1) discard;
  }
  float dist = length(cameraPosition - vPosW);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  gl_FragColor = vec4(mix(uOutlineColor, uFogColor, clamp(fog, 0.0, 1.0)), uOpacity);
}
`;

export const outlineShared = {
  uResolution: { value: new THREE.Vector2(1280, 720) },
};

export interface ToonOpts {
  base: THREE.ColorRepresentation;
  shade: THREE.ColorRepresentation;
  rim?: number;
  rimWidth?: number;
  term?: number;
  soft?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  spec?: number;
  specColor?: THREE.ColorRepresentation;
  hair?: boolean;
  doubleSide?: boolean;
  backShade?: number;
  flutterAmp?: number;
  swayAmp?: number;
  rimTint?: THREE.ColorRepresentation;
  hemColor?: THREE.ColorRepresentation;
  hemGlow?: number;
  hemStart?: number;
  faceShadowY?: number;
  keyMul?: number;
  rimUpCut?: number;
  /** darken the uFaceShadowY band (fringe shadow) by this fraction */
  faceShadowDark?: number;
  /** let the backlight rim wrap onto edges that face sideways (0 = rim only on surfaces turned toward the light) */
  rimWrap?: number;
  /** sharp V-shaped cast shadow in object space: [y at x=0, rise per |x|, min z, darkening] */
  castV?: [number, number, number, number];
  /** the rim thins and dims with camera distance: [full rim until (m), far from (m), rim multiplier when far]; off unless given */
  rimFar?: [number, number, number];
  /** the rim fades toward the floor: [full rim above world y (m), low below world y (m), rim multiplier low]; off unless given */
  rimLow?: [number, number, number];
  /** hold the wind, sway and flare motion for 1/fps s at a time (animation on 2s at 12); off unless given */
  animFps?: number;
  /** bend the castV edge: [curvature (m per m^2 of x), wobble amplitude (m), wobble frequency (rad per m)]; off unless given */
  castCurve?: [number, number, number];
  /** hair angel ring: scalp centre and radii (object space), ring elevation (sin) and half-width */
  hairCentre?: THREE.Vector3;
  hairRadii?: THREE.Vector3;
  ringEl?: number;
  ringW?: number;
  /** read the hem glow from the aHem attribute (1 at the hem edge) instead of the flutter weight */
  hemEdge?: boolean;
  /** skinned cloth flare: outward swing of fluttering vertices (metres at flutter 1) */
  flare?: number;
  flareBack?: number;
  /**
   * Drawn cloth lines (folds, seams) in the cloth's cylinder coordinates (object space). Each line:
   * [yTop, yBot, angleTop, angleBot, bow, half width (m), alpha (its sign picks the sheen side), taper exponent].
   * space: [z/x ellipse ratio, centre z, angle below which 2 PI is added, centre x (default 0)]. Off unless given.
   */
  strokes?: { lines: number[][]; space: [number, number, number] | [number, number, number, number]; ink?: THREE.ColorRepresentation; sheen?: THREE.ColorRepresentation };
  /**
   * Hard shadow thrown by an open garment's edges onto this one: shaded where the object-space angle from the front
   * passes halfAngle(y) - band. half: [a, b, c, yRef] for a + b*dy + c*dy^2; band: [his right (-x), his left (+x)].
   * Off unless given.
   */
  occlude?: { half: [number, number, number, number]; band: [number, number]; dark: number; cz?: number };
  /** hair: brightness of the mass close to the scalp, between the clumps (default 0.78) */
  hairDepth?: number;
  /** hair: darken each lock toward its edges by this much (drawn strand separations); off unless given */
  hairLines?: number;
  /** face shadow band edge drawn as a few pointed tongues (the fringe's cast shadow) instead of a fine saw */
  faceTongues?: boolean;
  /**
   * face shadow band edge drawn from the fringe itself (overrides faceTongues): one tongue per lock [x, depth, half
   * width] (object space, m) and a rise of the edge toward the temples (m per m^2 of x). Off unless given.
   */
  faceMask?: { tongues: [number, number, number][]; rise: number };
  /** added to the shared key direction before lighting this material (world space); off unless given */
  keyBias?: [number, number, number];
  /** scale of the shared violet ground bounce on this material (default 1) */
  groundMul?: number;
  /** the key fades with camera distance: [full key until (m), faded from (m), key multiplier when far]; off unless given */
  keyFar?: [number, number, number];
  /**
   * hair: a sliver of sheen on each lock that carries strand coordinates (geo strandPts `sheen`). at: centre along the
   * lock (0 root .. 1 tip), jitter: random shift of that centre per lock, len: half length along the lock, w: half width
   * across the lock (-1..1), dark: share left on the side turned from the key, color: added colour. Off unless given.
   */
  hairSheen?: { at: number; jitter: number; len: number; w: number; dark: number; color: THREE.ColorRepresentation };
  /** clamp the key mix at the lit colour (a boosted keyMul reaches the lit paint under a weak key, never past it); off unless given */
  keyClamp?: boolean;
  /** dim the whole shaded colour with camera distance: [full until (m), dimmed from (m), multiplier when far]; off unless given */
  farDim?: [number, number, number];
  /** fade the emissive with camera distance: [full until (m), faded from (m), multiplier when far]; off unless given */
  emissiveFar?: [number, number, number];
  /** faceMask: tilt of the band edge (m of drop per m of +x; positive drops it on the -x side); off unless given */
  faceMaskSlope?: number;
  /**
   * light a rigid mesh as if its normals pointed out of an ellipsoid (object space centre and radii), blended with the
   * real normals; clean cel face shadows. Only the key reads it (the rim keeps the real edges). Off unless given.
   */
  shadeNormal?: { centre: THREE.Vector3; radii: THREE.Vector3; blend: number };
}

export type ToonMaterial = THREE.ShaderMaterial & { userData: { toon: true } };

export function makeToon(o: ToonOpts): ToonMaterial {
  const emissive = new THREE.Color(o.emissive ?? 0x000000).multiplyScalar(o.emissiveIntensity ?? 1);
  const extra: Record<string, THREE.IUniform> = {};
  const defines: Record<string, string> = { ...(o.hair ? { HAIR: '' } : {}), ...(o.hemEdge ? { HEM: '' } : {}) };
  if (o.hair && o.hairDepth !== undefined) defines.HAIR_DEPTH = o.hairDepth.toFixed(4);
  if (o.hair && o.hairLines) defines.HAIR_LINES = o.hairLines.toFixed(4);
  if (o.faceTongues) defines.FACE_TONGUES = '';
  if (o.groundMul !== undefined) defines.GROUND_MUL = o.groundMul.toFixed(4);
  if (o.keyBias) {
    defines.KEY_BIAS = '';
    extra.uKeyBias = { value: new THREE.Vector3(...o.keyBias) };
  }
  if (o.keyFar) {
    defines.KEY_FAR = '';
    extra.uKeyFar = { value: new THREE.Vector3(...o.keyFar) };
  }
  if (o.rimFar) {
    defines.RIM_FAR = '';
    extra.uRimFar = { value: new THREE.Vector3(...o.rimFar) };
  }
  if (o.rimLow) {
    defines.RIM_LOW = '';
    extra.uRimLow = { value: new THREE.Vector3(...o.rimLow) };
  }
  if (o.faceMask && o.faceMask.tongues.length) {
    defines.FACE_MASK = String(o.faceMask.tongues.length);
    extra.uFaceMask = { value: o.faceMask.tongues.map((t) => new THREE.Vector3(...t)) };
    extra.uFaceMaskRise = { value: o.faceMask.rise };
  }
  if (o.keyClamp) defines.KEY_CLAMP = '';
  if (o.shadeNormal) {
    defines.SHADE_NORMAL = '';
    extra.uShadeC = { value: o.shadeNormal.centre.clone() };
    extra.uShadeR = { value: o.shadeNormal.radii.clone() };
    extra.uShadeBlend = { value: o.shadeNormal.blend };
  }
  if (o.emissiveFar) {
    defines.EMISSIVE_FAR = '';
    extra.uEmissiveFar = { value: new THREE.Vector3(...o.emissiveFar) };
  }
  if (o.farDim) {
    defines.FAR_DIM = '';
    extra.uFarDim = { value: new THREE.Vector4(o.farDim[0], o.farDim[1], o.farDim[2], 0) };
  }
  if (o.faceMask && o.faceMask.tongues.length && o.faceMaskSlope) {
    defines.FACE_MASK_SLOPE = '';
    extra.uFaceMaskSlope = { value: o.faceMaskSlope };
  }
  if (o.castCurve) {
    defines.CAST_CURVE = '';
    extra.uCastCurve = { value: new THREE.Vector3(...o.castCurve) };
  }
  if (o.hair && o.hairSheen) {
    const s = o.hairSheen;
    defines.HAIR_SHEEN = '';
    extra.uHairSheenA = { value: new THREE.Vector4(s.at, s.jitter, s.len, s.w) };
    extra.uHairSheenB = { value: new THREE.Vector4(s.dark, 0, 0, 0) };
    extra.uHairSheen = { value: new THREE.Color(s.color) };
  }
  if (o.strokes && o.strokes.lines.length) {
    const L = o.strokes.lines;
    defines.INK_STROKES = String(L.length);
    extra.uStrokeA = { value: L.map((l) => new THREE.Vector4(l[0], l[1], l[2], l[3])) };
    extra.uStrokeB = { value: L.map((l) => new THREE.Vector4(l[4], l[5], l[6], l[7])) };
    extra.uStrokeSpace = { value: new THREE.Vector4(o.strokes.space[0], o.strokes.space[1], o.strokes.space[2], o.strokes.space[3] ?? 0) };
    extra.uInkColor = { value: new THREE.Color(o.strokes.ink ?? 0x020106) };
    extra.uSheenColor = { value: new THREE.Color(o.strokes.sheen ?? 0x000000) };
  }
  if (o.occlude) {
    defines.OCCLUDE = '';
    extra.uOcclA = { value: new THREE.Vector4(...o.occlude.half) };
    extra.uOcclB = { value: new THREE.Vector4(o.occlude.band[0], o.occlude.band[1], o.occlude.dark, o.occlude.cz ?? 0) };
  }
  const m = new THREE.ShaderMaterial({
    vertexShader: toonVert,
    fragmentShader: toonFrag,
    defines,
    side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      ...light,
      uBase: { value: new THREE.Color(o.base) },
      uShade: { value: new THREE.Color(o.shade) },
      uRimMat: { value: o.rim ?? 1 },
      uRimWidth: { value: o.rimWidth ?? 0.55 },
      uTerm: { value: o.term ?? 0.1 },
      uSoft: { value: o.soft ?? 0.03 },
      uEmissive: { value: emissive },
      uSpec: { value: o.spec ?? 0 },
      uSpecColor: { value: new THREE.Color(o.specColor ?? 0x6f8fd8) },
      uDissolve: { value: 0 },
      uDissolveColor: { value: new THREE.Color(0x7b3fe4) },
      uClipY: { value: -100 },
      uClipColor: { value: new THREE.Color(0x8a5cff) },
      uBackShade: { value: o.backShade ?? 0.55 },
      uFlutterAmp: { value: o.flutterAmp ?? 0 },
      uSwayAmp: { value: o.swayAmp ?? 0 },
      uOpacity: { value: 1 },
      uRimTint: { value: new THREE.Color(o.rimTint ?? 0xffffff) },
      uHemColor: { value: new THREE.Color(o.hemColor ?? 0x000000) },
      uHemGlow: { value: o.hemGlow ?? 0 },
      uHemStart: { value: o.hemStart ?? 2 },
      uFaceShadowY: { value: o.faceShadowY ?? -100 },
      uKeyMul: { value: o.keyMul ?? 1 },
      uRimUpCut: { value: o.rimUpCut ?? 0 },
      uFaceShadowDark: { value: o.faceShadowDark ?? 0 },
      uRimWrap: { value: o.rimWrap ?? 0 },
      uCastV: { value: new THREE.Vector4(...(o.castV ?? [0, 0, -100, 0])) },
      uHairC: { value: (o.hairCentre ?? new THREE.Vector3(0, 0.12, 0)).clone() },
      uHairR: { value: (o.hairRadii ?? new THREE.Vector3(0.082, 0.086, 0.104)).clone() },
      uRingEl: { value: o.ringEl ?? 0.4 },
      uRingW: { value: o.ringW ?? 0.03 },
      uFlare: { value: o.flare ?? 0 },
      uFlareBack: { value: o.flareBack ?? 0.5 },
      uAnimFps: { value: o.animFps ?? 0 },
      ...extra,
    },
  }) as ToonMaterial;
  m.userData.toon = true;
  return m;
}

export function makeOutline(px = 1.6, color: THREE.ColorRepresentation = 0x020208, flutterAmp = 0, swayAmp = 0, flare = 0, flareBack = 0.5, animFps = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    uniforms: {
      ...light,
      ...outlineShared,
      uOutlinePx: { value: px },
      uRefDist: { value: 3.0 },
      uOutlineColor: { value: new THREE.Color(color) },
      uClipY: { value: -100 },
      uDissolve: { value: 0 },
      uFlutterAmp: { value: flutterAmp },
      uSwayAmp: { value: swayAmp },
      uFlare: { value: flare },
      uFlareBack: { value: flareBack },
      uAnimFps: { value: animFps },
      uOpacity: { value: 1 },
    },
  });
}

/** Ensure the custom attributes exist so the shader always has inputs. */
export function ensureAttrs(g: THREE.BufferGeometry) {
  const n = g.attributes.position.count;
  if (!g.attributes.aFlutter) g.setAttribute('aFlutter', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aSway) g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!g.attributes.aTangent) g.setAttribute('aTangent', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return g;
}
