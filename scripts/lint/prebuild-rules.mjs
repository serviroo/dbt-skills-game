function banned(names, message) {
  return {
    meta: { messages: { inline: message } },
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
          if (names.has(node.name) && !declared) report(node);
        },
        Literal(node) {
          if (names.has(node.value)) report(node);
        },
        TemplateElement(node) {
          if (names.has(node.value.cooked)) report(node);
        },
      };
    },
  };
}

export const prebuildRules = {
  'timed-cues-are-prebuilt': banned(new Set(['openBuilt', 'Prebuilt', 'openPrebuilt']),
    'Build and open held sounds only through src/audio/prebuild.ts (open, openCopies, copiesAhead), '
      + 'so it alone decides when their copies are built.'),
  'events-reach-sounds-through-the-timeline': banned(new Set(['pendingEvents', 'named', 'soundAt', 'nameAt']),
    'Plan events and find their sounds only through the Timeline in src/audio/pending-events.ts, which points each '
      + 'event at one sound and drops what a stop, a visit or a reset has passed.'),
};
