import { ApprovalRepository } from "../repositories/approvalRepository.js";
import { JobQueue } from "../repositories/jobQueue.js";
import { RunRepository } from "../repositories/runRepository.js";
import { ScheduleRepository } from "../repositories/scheduleRepository.js";
import { StepRepository } from "../repositories/stepRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { WorkflowRepository } from "../repositories/workflowRepository.js";

class Repositories {
  constructor(db) {
    this.workflows = new WorkflowRepository(db);
    this.runs = new RunRepository(db);
    this.steps = new StepRepository(db);
    this.approvals = new ApprovalRepository(db);
    this.queue = new JobQueue(db);
    this.schedules = new ScheduleRepository(db);
    this.users = new UserRepository(db);
  }
}

export class UnitOfWork {
  #database;

  constructor(database) {
    this.#database = database;
    this.repos = new Repositories(database);
  }

  transaction(work) {
    return this.#database.transaction((client) => work(new Repositories(client)));
  }
}
