export function missed(stage) {
  stage.composer.multisampling = 0;
}

export function wrongStage(stage, other) {
  stage.composer.multisampling = 0;
  other.invalidate();
}

export function tooEarly(stage) {
  stage.invalidate();
  stage.composer.multisampling = 0;
}

export function refreshed(stage) {
  stage.composer.multisampling = 0;
  stage.invalidate();
}

export class Stage {
  change() {
    this.composer.multisampling = 0;
    this.invalidate();
  }
}
