export function withoutSecret(definition) {
  if (definition.trigger?.secret === undefined) return definition;
  const trigger = { ...definition.trigger };
  delete trigger.secret;
  return { ...definition, trigger };
}

export function findNode(definition, nodeId) {
  return definition.nodes.find((node) => node.id === nodeId);
}

export function nodeEdges(node) {
  return node.type === "condition" ? [node.on_true, node.on_false] : [node.next];
}

export function nextNodeId(node, output) {
  if (node.type === "condition") return output.result ? node.on_true : node.on_false;
  return node.next;
}
