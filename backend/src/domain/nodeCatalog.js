import { readFileSync } from "node:fs";
import path from "node:path";

export class NodeCatalog {
  #specs;

  constructor(file) {
    this.file = file;
    this.#specs = new Map(file.nodes.map((spec) => [spec.type, spec]));
  }

  static load(dataDir) {
    return new NodeCatalog(
      JSON.parse(readFileSync(path.join(dataDir, "node_catalog.json"), "utf8")),
    );
  }

  spec(type) {
    return this.#specs.get(type);
  }

  requiresApproval(type) {
    return this.#specs.get(type)?.requires_approval ?? false;
  }
}
