const OPENER = 'openBuilt';

const timedCuesArePrebuilt = {
  meta: {
    messages: {
      inline: 'Open held sounds with openPrebuilt from src/audio/prebuild.ts, so every try takes a copy built ahead.',
    },
  },
  create(context) {
    const reported = new Set();
    const report = (node) => {
      if (reported.has(node.start)) return;
      reported.add(node.start);
      context.report({ node, messageId: 'inline' });
    };
    return {
      Identifier(node) {
        const declared = node.parent?.type === 'MethodDefinition' && node.parent.key === node;
        if (node.name === OPENER && !declared) report(node);
      },
      Literal(node) {
        if (node.value === OPENER) report(node);
      },
      TemplateElement(node) {
        if (node.value.cooked === OPENER) report(node);
      },
    };
  },
};

export const prebuildRules = { 'timed-cues-are-prebuilt': timedCuesArePrebuilt };
