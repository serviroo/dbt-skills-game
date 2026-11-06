import { BloomEffect, RenderPass } from 'postprocessing';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';

export class ScenePass extends RenderPass {
  still = false;
  dirty = true;
  refreshed = false;

  get needsRender() {
    return !this.still || this.dirty;
  }

  override render(
    renderer: WebGLRenderer,
    input: WebGLRenderTarget | null,
    output: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean,
  ) {
    this.refreshed = this.needsRender;
    if (!this.refreshed) return;
    super.render(renderer, input, output, deltaTime, stencilTest);
    this.dirty = false;
  }
}

export class SceneBloomEffect extends BloomEffect {
  constructor(private scenePass: ScenePass, options: ConstructorParameters<typeof BloomEffect>[0]) {
    super(options);
  }

  override update(renderer: WebGLRenderer, input: WebGLRenderTarget, dt?: number) {
    if (this.scenePass.refreshed) super.update(renderer, input, dt);
  }
}
