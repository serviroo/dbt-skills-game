import { packModel } from './pack-model.mjs';

await packModel(process.argv[2], 'moth', [{ slots: /^baseColorTexture$/, resize: [1024, 1024], quality: 88 }]);
