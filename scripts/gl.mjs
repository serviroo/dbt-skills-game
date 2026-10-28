// Browser children, including the icon draw inside a build, inherit an explicit software choice.
if (process.argv.includes('--software')) process.env.LANTERN_GL = 'software';

function software() {
  const mode = process.env.LANTERN_GL;
  if (mode !== undefined && mode !== 'software') throw new Error(`unknown LANTERN_GL mode: ${mode}`);
  return mode === 'software';
}

export function glArgs() {
  return software()
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
}

/** `remote`: the page is in a browser another machine started for scripts/e2e.mjs --ws. */
export async function checkRenderer(page, { remote = false } = {}) {
  const { renderer, unmasked } = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no webgl', unmasked: !!info };
  });
  if (!unmasked) throw new Error(`WebGL renderer cannot be verified: ${renderer}`);
  const fix = remote ? `; a --ws browser gets its flags where it was started, so start it with node scripts/e2e-browser.mjs${software() ? ' --software' : ''}` : '';
  if (software()) {
    if (!/SwiftShader/i.test(renderer)) throw new Error(`--software requires SwiftShader; renderer: ${renderer}${fix}`);
  } else if (/SwiftShader|llvmpipe|softpipe|no webgl/i.test(renderer)) {
    throw new Error(`WebGL renderer is not a GPU: ${renderer}${fix}`);
  }
  return renderer;
}
