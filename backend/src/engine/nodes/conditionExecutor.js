import { PermanentError } from "../../shared/errors.js";
import { completed } from "./nodeResult.js";

const DECIMAL = /^-?\d+(\.\d+)?$/;

function asNumber(value, label) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string" && DECIMAL.test(value)) return Number(value);
  throw new PermanentError("invalid_comparison", `${label} value '${value}' is not a number`);
}

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value));

const OPERATORS = {
  equals: (left, right) => asText(left) === asText(right),
  not_equals: (left, right) => asText(left) !== asText(right),
  contains: (left, right) => asText(left).includes(asText(right)),
  greater_than: (left, right) => asNumber(left, "Left") > asNumber(right, "Right"),
  less_than: (left, right) => asNumber(left, "Left") < asNumber(right, "Right"),
};

export class ConditionExecutor {
  hasSideEffect() {
    return false;
  }

  async execute({ params: { left, op, right } }) {
    return completed({ result: OPERATORS[op](left, right) });
  }
}
