import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const STILL = [0, 0, 0, 1];
const TANGENT = [0.4, 0.4, 0.4, 0.4];
const TRIANGLE = [0.5, 1, 0, 0.6, 1, 0, 0.5, 1.1, 0];
const shift = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const xf = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);

function skeleton(doc, buffer) {
  const pelvis = doc.createNode('pelvis').setTranslation([0, 1, 0]);
  const hand = doc.createNode('hand_r').setTranslation([0.5, 0, 0]);
  pelvis.addChild(hand);
  const ibm = new Float32Array([...shift([0, -1, 0]), ...shift([-0.5, -1, 0])]);
  const skin = doc.createSkin().addJoint(pelvis).addJoint(hand).setSkeleton(pelvis)
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  return { pelvis, hand, skin };
}

async function writeRig(file, { decoyScene, idle }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const { pelvis, hand } = skeleton(doc, buffer);
  if (decoyScene) doc.createScene('props').addChild(doc.createNode('lamp'));
  doc.createScene('rig').addChild(pelvis);
  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const clip = (name, interpolation, values) => {
    const output = doc.createAccessor().setType('VEC4').setArray(new Float32Array(values)).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation(interpolation);
    const channel = doc.createAnimationChannel().setTargetNode(hand).setTargetPath('rotation').setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  };
  if (idle === 'CUBICSPLINE') clip('idle', idle, [...TANGENT, ...STILL, ...TANGENT, ...TANGENT, ...STILL, ...TANGENT]);
  else clip('idle', idle, [...STILL, ...STILL]);
  clip('reach', 'LINEAR', [...STILL, ...STILL]);
  clip('hold', 'LINEAR', [...STILL, ...STILL]);
  await io.write(file, doc);
}

async function writeRaw(file) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const { pelvis, skin } = skeleton(doc, buffer);
  const attr = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', attr('VEC3', new Float32Array(TRIANGLE)))
    .setAttribute('NORMAL', attr('VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setAttribute('JOINTS_0', attr('VEC4', new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
    .setAttribute('WEIGHTS_0', attr('VEC4', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])));
  const body = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim)).setSkin(skin);
  doc.createScene('raw').addChild(pelvis).addChild(body);
  await io.write(file, doc);
}

async function build(expect, rigOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-build-'));
  try {
    const [rig, raw, out] = ['rig.glb', 'raw.glb', 'out.glb'].map((f) => path.join(dir, f));
    await writeRig(rig, rigOptions);
    await writeRaw(raw);
    try {
      const args = ['scripts/build-hero.mjs', raw, '--rig', rig, '--out', out];
      await promisify(execFile)(process.execPath, args, { cwd: root });
    } catch (e) {
      expect(false, `the build stopped: ${e.stderr || e.message}`);
      return null;
    }
    return (await io.read(out)).getRoot();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function boundWhereBuilt(expect, built) {
  const body = built.listNodes().find((n) => n.getMesh());
  const skin = body?.getSkin();
  const joints = skin?.listJoints().map((j) => j.getName()) ?? [];
  expect(joints.join() === 'pelvis,hand_r', `the built mesh is bound to [${joints}], not the rig's pelvis and hand_r`);
  if (joints.length !== 2) return;
  const hand = skin.listJoints()[1];
  const bind = skin.getInverseBindMatrices().getElement(1, []);
  const pos = body.getMesh().listPrimitives()[0].getAttribute('POSITION');
  for (let i = 0; i < pos.getCount(); i++) {
    const at = xf(hand.getWorldMatrix(), xf(bind, pos.getElement(i, [])));
    const want = TRIANGLE.slice(i * 3, i * 3 + 3);
    const off = Math.max(...at.map((x, k) => Math.abs(x - want[k])));
    expect(off < 1e-3, `vertex ${i} sits at [${at.map((x) => x.toFixed(3))}] in the idle pose, not [${want}]`);
  }
}

export const scenarios = {
  async 'hero-build-keeps-the-skeletons-scene'({ expect }) {
    const built = await build(expect, { decoyScene: true, idle: 'LINEAR' });
    if (built) boundWhereBuilt(expect, built);
  },

  async 'hero-build-binds-a-cubic-idle-at-its-first-key'({ expect }) {
    const built = await build(expect, { decoyScene: false, idle: 'CUBICSPLINE' });
    if (built) boundWhereBuilt(expect, built);
  },
};
