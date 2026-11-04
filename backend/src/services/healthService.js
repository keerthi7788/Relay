export class HealthService {
  #database;

  constructor(database) {
    this.#database = database;
  }

  async isReady() {
    try {
      await this.#database.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
