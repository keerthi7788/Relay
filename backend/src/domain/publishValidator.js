import { Ajv } from "ajv";
import { isValidCron } from "./cron.js";
import { findNode, nodeEdges } from "./definition.js";
import { guardrailErrors, settingsFor } from "./guardrailSettings.js";
import { templatePaths } from "./templates.js";

const SUPPORTED_TRIGGERS = ["webhook", "schedule", "manual"];
const REQUIRED_FIELDS = ["name", "trigger", "entry", "limits"];
const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;
// These decide where a side effect lands, so AI output must never fill them in.
const CONTROL_PARAMS = {
  notify: ["to"],
  http_request: ["url", "headers"],
  order_action: ["order_id", "action"],
};

const issue = (code, message, nodeId) => ({ code, message, node_id: nodeId });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function isValidJsonSchema(schema) {
  try {
    new Ajv({ strict: false }).compile(schema);
    return true;
  } catch {
    return false;
  }
}

function matchesSpec(value, spec) {
  if (spec.enum) return spec.enum.includes(value);
  if (spec.type === "object") return isObject(value);
  if (spec.type === "number") return Number.isFinite(value);
  return typeof value === spec.type;
}

export class PublishValidator {
  #catalog;

  constructor(catalog) {
    this.#catalog = catalog;
  }

  validate(definition) {
    const shapeErrors = this.#shapeErrors(definition);
    if (shapeErrors.length > 0) return { errors: shapeErrors, warnings: [] };

    const errors = [
      ...this.#triggerErrors(definition.trigger),
      ...guardrailErrors(definition, this.#catalog).map((message) =>
        issue("invalid_guardrails", message),
      ),
      ...this.#duplicateIdErrors(definition),
      ...definition.nodes.flatMap((node) => this.#nodeErrors(node, definition)),
    ];
    if (!findNode(definition, definition.entry)) {
      errors.push(issue("invalid_entry", `Entry '${definition.entry}' does not match any node`));
    }
    return { errors, warnings: errors.length > 0 ? [] : this.#approvalWarnings(definition) };
  }

  #shapeErrors(definition) {
    const errors = REQUIRED_FIELDS.filter((field) => definition[field] == null).map((field) =>
      issue("invalid_definition", `Definition is missing '${field}'`),
    );
    if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
      errors.push(issue("invalid_definition", "Definition needs at least one node"));
    } else if (!definition.nodes.every((node) => isObject(node) && typeof node.id === "string")) {
      errors.push(issue("invalid_definition", "Every node must be an object with a string id"));
    }
    if (definition.trigger != null && !isObject(definition.trigger)) {
      errors.push(issue("invalid_definition", "trigger must be an object"));
    }
    return errors;
  }

  #triggerErrors(trigger) {
    if (!SUPPORTED_TRIGGERS.includes(trigger.type)) {
      return [issue("invalid_trigger", `Trigger type '${trigger.type}' is not supported`)];
    }
    const errors = [];
    if (trigger.type === "schedule" && !isValidCron(trigger.cron)) {
      errors.push(issue("invalid_trigger", `'${trigger.cron}' is not a 5-field cron expression`));
    }
    if (trigger.enabled !== undefined && typeof trigger.enabled !== "boolean") {
      errors.push(issue("invalid_trigger", "trigger.enabled must be true or false"));
    }
    if (trigger.input !== undefined && !isObject(trigger.input)) {
      errors.push(issue("invalid_trigger", "trigger.input must be an object"));
    }
    return errors;
  }

  #duplicateIdErrors({ nodes }) {
    return new Set(nodes.map((node) => node.id)).size === nodes.length
      ? []
      : [issue("invalid_definition", "Node ids must be unique")];
  }

  #nodeErrors(node, definition) {
    const spec = this.#catalog.spec(node.type);
    if (!spec) {
      return [
        issue("invalid_node_type", `Node '${node.id}' has unknown type '${node.type}'`, node.id),
      ];
    }
    return [
      ...this.#edgeErrors(node, definition),
      ...this.#paramErrors(node, spec),
      ...this.#typeSpecificErrors(node),
      ...this.#controlParamErrors(node, definition),
    ];
  }

  #edgeErrors(node, definition) {
    const isCondition = node.type === "condition";
    const wellFormed = isCondition
      ? node.on_true !== undefined && node.on_false !== undefined && node.next === undefined
      : node.next !== undefined && node.on_true === undefined && node.on_false === undefined;
    if (!wellFormed) {
      const expected = isCondition ? "on_true and on_false" : "next (null ends the run)";
      return [issue("invalid_definition", `Node '${node.id}' needs ${expected}`, node.id)];
    }
    return nodeEdges(node)
      .filter((target) => target !== null && !findNode(definition, target))
      .map((target) =>
        issue(
          "invalid_node_reference",
          `Node '${node.id}' points to missing node '${target}'`,
          node.id,
        ),
      );
  }

  #paramErrors(node, spec) {
    const params = isObject(node.params) ? node.params : {};
    return Object.entries(spec.params).flatMap(([name, paramSpec]) => {
      const value = params[name];
      if (value === undefined || value === "") {
        return paramSpec.required
          ? [
              issue(
                "missing_required_param",
                `Node '${node.id}' is missing param '${name}'`,
                node.id,
              ),
            ]
          : [];
      }
      return matchesSpec(value, paramSpec)
        ? []
        : [issue("invalid_definition", `Node '${node.id}' has an invalid '${name}'`, node.id)];
    });
  }

  #controlParamErrors(node, definition) {
    const params = isObject(node.params) ? node.params : {};
    return (CONTROL_PARAMS[node.type] ?? []).flatMap((name) => {
      const fromAi = templatePaths(JSON.stringify(params[name] ?? "")).some((path) => {
        const [root, target] = path.split(".");
        return root === "nodes" && findNode(definition, target)?.type === "ai";
      });
      return fromAi
        ? [
            issue(
              "ai_output_in_control_param",
              `Node '${node.id}' can't use AI output in '${name}'`,
              node.id,
            ),
          ]
        : [];
    });
  }

  #typeSpecificErrors(node) {
    const params = node.params ?? {};
    if (node.type === "delay" && Number.isFinite(params.seconds)) {
      return params.seconds >= 0 && params.seconds <= MAX_DELAY_SECONDS
        ? []
        : [
            issue(
              "invalid_definition",
              `Node '${node.id}' seconds must be from 0 to ${MAX_DELAY_SECONDS}`,
              node.id,
            ),
          ];
    }
    if (node.type === "ai" && params.output_schema !== undefined) {
      const { output_schema: schema } = params;
      return isObject(schema) && schema.type === "object" && isValidJsonSchema(schema)
        ? []
        : [
            issue(
              "invalid_definition",
              `Node '${node.id}' needs a valid output_schema of type object`,
              node.id,
            ),
          ];
    }
    return [];
  }

  #approvalWarnings(definition) {
    const { requireApprovalFor } = settingsFor(definition);
    const needsApproval = ({ type }) =>
      this.#catalog.requiresApproval(type) || requireApprovalFor.includes(type);
    const unguarded = new Set();
    const visited = new Set();
    const pending = [{ id: definition.entry, approved: false }];

    while (pending.length > 0) {
      const { id, approved } = pending.pop();
      const key = `${id}:${approved}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const node = findNode(definition, id);
      if (needsApproval(node) && !approved) unguarded.add(id);
      for (const target of nodeEdges(node)) {
        if (target) pending.push({ id: target, approved: approved || node.type === "approval" });
      }
    }

    return [...unguarded].map((id) =>
      issue(
        "sensitive_node_without_approval",
        `'${id}' can be reached with no approval before it; the engine will refuse to run it`,
        id,
      ),
    );
  }
}
