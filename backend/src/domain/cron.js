import { CronExpressionParser } from "cron-parser";

export function isValidCron(expression) {
  if (typeof expression !== "string" || expression.trim().split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

export function nextFireAfter(expression, from = new Date()) {
  return CronExpressionParser.parse(expression, { currentDate: from, tz: "UTC" }).next().toDate();
}
