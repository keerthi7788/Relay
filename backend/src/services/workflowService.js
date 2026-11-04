import { readFileSync } from "node:fs";
import path from "node:path";
import { nextFireAfter } from "../domain/cron.js";
import { withoutSecret } from "../domain/definition.js";
import { guardrailErrors } from "../domain/guardrailSettings.js";
import {
  BadRequestError,
  ConflictError,
  InvalidDefinitionError,
  NotFoundError,
} from "../shared/errors.js";
import { generateWebhookSecret, hashSecret } from "../shared/secrets.js";

const usesWebhook = (definition) => definition.trigger?.type === "webhook";

export class WorkflowService {
  #uow;
  #validator;
  #catalog;
  #samples;

  constructor(uow, validator, catalog, dataDir) {
    this.#uow = uow;
    this.#validator = validator;
    this.#catalog = catalog;
    this.#samples = readFileSync(path.join(dataDir, "sample_payloads.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  async list(page) {
    const { workflows, runs } = this.#uow.repos;
    const items = await workflows.list(page);
    const latest = await runs.latestForWorkflows(items.map(({ id }) => id));
    const byWorkflow = new Map(latest.map((run) => [run.workflowId, run]));
    return items.map((item) => ({ ...item, latestRun: byWorkflow.get(item.id) }));
  }

  async get(id) {
    const workflow = await this.#uow.repos.workflows.find(id);
    if (!workflow) throw new NotFoundError("Workflow", id);
    return workflow;
  }

  catalog() {
    return this.#catalog.file;
  }

  samplePayloads(workflowId) {
    return this.#samples.filter(({ workflow }) => !workflowId || workflow === workflowId);
  }

  async create(definition) {
    const provided = definition.trigger?.secret;
    const generated = usesWebhook(definition) && !provided ? generateWebhookSecret() : undefined;
    const secret = provided ?? generated;

    const created = await this.#uow.repos.workflows.insertDraft(
      withoutSecret(definition),
      secret ? hashSecret(secret) : null,
    );
    if (!created) {
      throw new ConflictError("workflow_exists", `Workflow '${definition.id}' already exists`);
    }
    return { workflow: await this.get(definition.id), generatedSecret: generated };
  }

  async update(id, definition) {
    const current = await this.get(id);
    return this.#saveDraft(current, { ...definition, id });
  }

  async updateTrigger(id, trigger) {
    const current = await this.get(id);
    return this.#saveDraft(current, { ...current.draftDefinition, trigger });
  }

  async updateGuardrails(id, { limits, guardrails }) {
    const current = await this.get(id);
    const next = { ...current.draftDefinition };
    if (limits) next.limits = { ...next.limits, ...limits };
    if (guardrails) next.guardrails = { ...next.guardrails, ...guardrails };
    const errors = guardrailErrors(next, this.#catalog);
    if (errors.length > 0) {
      throw new InvalidDefinitionError(
        "invalid_guardrails",
        errors[0],
        errors.map((message) => ({ code: "invalid_guardrails", message })),
      );
    }
    return this.#saveDraft(current, next);
  }

  async rotateSecret(id) {
    const { draftDefinition } = await this.get(id);
    if (!usesWebhook(draftDefinition)) {
      throw new ConflictError("not_a_webhook_workflow", `Workflow '${id}' has no webhook trigger`);
    }
    const secret = generateWebhookSecret();
    await this.#uow.repos.workflows.setSecretHash(id, hashSecret(secret));
    return secret;
  }

  // Locks the row, so an edit arriving mid-publish can't be published unvalidated.
  async publish(id) {
    const warnings = await this.#uow.transaction(async (repos) => {
      const workflow = await repos.workflows.lock(id);
      if (!workflow) throw new NotFoundError("Workflow", id);
      const { draftDefinition } = workflow;

      const result = this.#validator.validate(draftDefinition);
      if (result.errors.length > 0) {
        const [first] = result.errors;
        throw new InvalidDefinitionError(first.code, first.message, result.errors);
      }
      await repos.workflows.publish(id, draftDefinition);
      await this.#syncSchedule(repos, id, draftDefinition.trigger);
      return result.warnings;
    });
    return { workflow: await this.get(id), warnings };
  }

  async loadSeeds(dataDir) {
    const file = path.join(dataDir, "seed_workflows.json");
    const { workflows } = JSON.parse(readFileSync(file, "utf8"));
    for (const definition of workflows) {
      const { errors } = this.#validator.validate(definition);
      if (errors.length > 0) {
        throw new Error(`Seed '${definition.id}' is invalid: ${errors[0].message}`);
      }
      const secret = definition.trigger.secret;
      await this.#uow.repos.workflows.insertPublishedIfMissing(
        withoutSecret(definition),
        secret ? hashSecret(secret) : null,
      );
    }
  }

  async #saveDraft(current, definition) {
    if (definition.trigger?.secret !== undefined) {
      throw new BadRequestError(
        "secret_not_allowed",
        "Change a webhook secret with POST /workflows/{id}/trigger/rotate-secret",
      );
    }
    const generated =
      usesWebhook(definition) && !current.webhookSecretHash ? generateWebhookSecret() : undefined;

    await this.#uow.transaction(async (repos) => {
      await repos.workflows.updateDraft(definition);
      if (generated) await repos.workflows.setSecretHash(current.id, hashSecret(generated));
    });
    return { workflow: await this.get(current.id), generatedSecret: generated };
  }

  async #syncSchedule(repos, workflowId, trigger) {
    if (trigger.type !== "schedule" || trigger.enabled === false) {
      await repos.schedules.remove(workflowId);
      return;
    }
    await repos.schedules.upsert({
      workflowId,
      cron: trigger.cron,
      input: trigger.input ?? {},
      nextFireAt: nextFireAfter(trigger.cron),
    });
  }
}
