export function frozen(stage: any, dt: number) {
  if (!stage.renderOnDemand || stage.needsRender) stage.step(dt);
  if (!stage.sceneStill) stage.composer.render(dt);
  return stage.needsRender ? stage.draw(dt) : stage.advance(dt);
}

export function moving(stage: any, dt: number) {
  if (stage.lost) return;
  if (!stage.sceneStill || stage.needsRender) stage.renderer.render(stage.scene, stage.camera);
  stage.composer.render(dt);
}
