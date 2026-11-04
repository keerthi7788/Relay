import { PermanentError } from "../shared/errors.js";

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_TEMPLATE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const DATA_TAG = "untrusted_data";

function lookup(scope, path) {
  const parts = path.split(".");
  const readable =
    (parts[0] === "trigger" && parts[1] === "body") ||
    (parts[0] === "nodes" && parts.length >= 3 && parts[2] === "output");
  if (!readable) {
    throw new PermanentError("template_out_of_scope", `Template path '${path}' is not readable`);
  }

  let current = scope;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new PermanentError(
        "template_unresolved",
        `Template path '${path}' could not be resolved`,
      );
    }
    current = current[part];
  }
  return current;
}

const renderInline = (value) => (typeof value === "string" ? value : JSON.stringify(value));

// Resolves in one pass, so template syntax inside a payload value is never expanded.
export function resolveValue(value, scope) {
  if (typeof value === "string") {
    const whole = value.match(WHOLE_TEMPLATE);
    if (whole) return lookup(scope, whole[1]);
    return value.replace(TEMPLATE, (_, path) => renderInline(lookup(scope, path)));
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, scope)]),
    );
  }
  return value;
}

// Marks every substituted value as data. A payload can't close the tag to escape it.
function renderPrompt(template, scope) {
  return template.replace(TEMPLATE, (_, path) => {
    const value = renderInline(lookup(scope, path)).replaceAll(DATA_TAG, "untrusted-data");
    return `<${DATA_TAG}>${value}</${DATA_TAG}>`;
  });
}

function resolveParam(node, name, value, scope) {
  return node.type === "ai" && name === "prompt"
    ? renderPrompt(value, scope)
    : resolveValue(value, scope);
}

export function resolveParams(node, spec, scope) {
  return Object.fromEntries(
    Object.entries(node.params).map(([name, value]) => [
      name,
      spec.params[name]?.templatable ? resolveParam(node, name, value, scope) : value,
    ]),
  );
}

export function buildScope(input, steps) {
  const nodes = {};
  for (const step of steps) {
    if (step.status === "succeeded") nodes[step.nodeId] = { output: step.output };
  }
  return { trigger: { body: input }, nodes };
}

export function templatePaths(text) {
  return [...text.matchAll(TEMPLATE)].map((match) => match[1]);
}

export function substitutedValues(template, scope) {
  return templatePaths(template).map((path) => renderInline(lookup(scope, path)));
}
