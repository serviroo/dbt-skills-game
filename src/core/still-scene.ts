import { BloomEffect, RenderPass } from 'postprocessing';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';

export class ScenePass extends RenderPass {
  still = false;
  dirty = true;
  refreshed = false;

  override render(renderer: WebGLRenderer, input: WebGLRenderTarget | null, output: WebGLRenderTarget | null) {
    this.refreshed = !this.still || this.dirty;
    if (!this.refreshed) return;
    super.render(renderer, input, output);
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
