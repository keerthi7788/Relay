import { Ajv } from "ajv";
import { PermanentError } from "../../shared/errors.js";
import { substitutedValues } from "../../domain/templates.js";
import { completed } from "./nodeResult.js";

export class AiExecutor {
  #ai;

  constructor(ai) {
    this.#ai = ai;
  }

  hasSideEffect() {
    return false;
  }

  async execute({ run, step, node, scope, params, settings }) {
    const result = await this.#ai.complete(
      {
        prompt: params.prompt,
        output_schema: params.output_schema,
        untrusted_values: substitutedValues(node.params.prompt, scope),
        guardrails: {
          flag_injection: settings.injectionDetection !== "off",
          strip_links: settings.stripLinks,
        },
      },
      { runId: run.runId, nodeId: step.nodeId },
    );

    // The engine answers for this guarantee, so it doesn't rely on the AI service alone.
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(params.output_schema);
    if (!validate(result.output)) {
      throw new PermanentError(
        "ai_schema_violation",
        `AI output failed its schema: ${ajv.errorsText(validate.errors)}`,
        result,
      );
    }
    return completed(result.output, {
      attempts: result.attempts,
      tokens: result.tokens,
      flags: result.flags,
    });
  }
}
