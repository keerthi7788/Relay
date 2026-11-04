import {
  ApprovalGuard,
  CancelGuard,
  GuardChain,
  InjectionApprovalGuard,
  StepCapGuard,
  TimeLimitGuard,
  TokenBudgetGuard,
} from "./guards.js";
import { AiExecutor } from "./nodes/aiExecutor.js";
import { ApprovalExecutor } from "./nodes/approvalExecutor.js";
import { ConditionExecutor } from "./nodes/conditionExecutor.js";
import { DelayExecutor } from "./nodes/delayExecutor.js";
import { ExecutorRegistry } from "./nodes/executorRegistry.js";
import { HttpRequestExecutor } from "./nodes/httpRequestExecutor.js";
import { NotifyExecutor } from "./nodes/notifyExecutor.js";
import { OrderActionExecutor } from "./nodes/orderActionExecutor.js";
import { RetryPolicy } from "./retryPolicy.js";
import { StepRunner } from "./stepRunner.js";

export function createStepRunner({
  uow,
  catalog,
  http,
  world,
  ai,
  retry,
  outboundHosts,
  afterExecute,
}) {
  const { approvals } = uow.repos;
  const executors = new ExecutorRegistry({
    http_request: new HttpRequestExecutor(http, outboundHosts),
    condition: new ConditionExecutor(),
    delay: new DelayExecutor(),
    notify: new NotifyExecutor(world),
    ai: new AiExecutor(ai),
    approval: new ApprovalExecutor(approvals),
    order_action: new OrderActionExecutor(world),
  });
  return new StepRunner({
    uow,
    catalog,
    executors,
    afterExecute,
    retryPolicy: new RetryPolicy(retry),
    guards: new GuardChain([
      new CancelGuard(),
      new StepCapGuard(),
      new TimeLimitGuard(approvals),
      new TokenBudgetGuard(),
      new ApprovalGuard(catalog, approvals),
      new InjectionApprovalGuard(executors, approvals),
    ]),
  });
}
