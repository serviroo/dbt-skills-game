const BANNED = new Set(['openBuilt', 'Prebuilt', 'openPrebuilt']);

const timedCuesArePrebuilt = {
  meta: {
    messages: {
      inline: 'Build and open held sounds only through src/audio/prebuild.ts (open, openCopies, copiesAhead), '
        + 'so it alone decides when their copies are built.',
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
        if (BANNED.has(node.name) && !declared) report(node);
      },
      Literal(node) {
        if (BANNED.has(node.value)) report(node);
      },
      TemplateElement(node) {
        if (BANNED.has(node.value.cooked)) report(node);
      },
    };
  },
};

export const prebuildRules = { 'timed-cues-are-prebuilt': timedCuesArePrebuilt };
