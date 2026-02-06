#!/usr/bin/env npx tsx
/**
 * AWS Cost Assessment Report
 *
 * Fetches AWS Cost Explorer data and generates a breakdown of costs
 * by service, with daily trends and monthly totals.
 *
 * Usage: npx tsx scripts/aws-cost-report.ts
 * Requires: AWS CLI configured with Cost Explorer access
 */

import { execSync } from "child_process";

interface CostGroup {
  Keys: string[];
  Metrics: {
    UnblendedCost: {
      Amount: string;
      Unit: string;
    };
  };
}

interface TimeResult {
  TimePeriod: { Start: string; End: string };
  Total?: { UnblendedCost: { Amount: string; Unit: string } };
  Groups?: CostGroup[];
}

interface CostResponse {
  ResultsByTime: TimeResult[];
}

function runAwsCommand(args: string): CostResponse {
  try {
    const result = execSync(`aws ce ${args} --output json`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (err) {
    console.error("AWS CLI error:", err);
    process.exit(1);
  }
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (num < 0.01 && num > 0) {
    return `$${num.toFixed(6)}`;
  }
  return `$${num.toFixed(2)}`;
}

// Get date ranges
const now = new Date();
const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
const firstOfMonth = `${currentMonth}-01`;
const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
const firstOfLastMonth = lastMonth.slice(0, 8) + "01";
const lastOfLastMonth = firstOfMonth;

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              AWS COST ASSESSMENT REPORT                        ║");
console.log("║              MoltApp Infrastructure                            ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log();

// ============================================================================
// Monthly Summary
// ============================================================================

console.log("┌────────────────────────────────────────────────────────────────┐");
console.log("│ MONTHLY SUMMARY                                                │");
console.log("└────────────────────────────────────────────────────────────────┘");

// Last month
const lastMonthData = runAwsCommand(
  `get-cost-and-usage --time-period Start=${firstOfLastMonth},End=${lastOfLastMonth} --granularity MONTHLY --metrics "UnblendedCost"`
);
const lastMonthTotal = parseFloat(
  lastMonthData.ResultsByTime[0]?.Total?.UnblendedCost.Amount ?? "0"
);

// Current month
const currentMonthData = runAwsCommand(
  `get-cost-and-usage --time-period Start=${firstOfMonth},End=${tomorrow} --granularity MONTHLY --metrics "UnblendedCost"`
);
const currentMonthTotal = parseFloat(
  currentMonthData.ResultsByTime[0]?.Total?.UnblendedCost.Amount ?? "0"
);

// Days elapsed this month
const daysElapsed = now.getDate();
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const projectedMonthly = (currentMonthTotal / daysElapsed) * daysInMonth;

console.log(`Last Month (${firstOfLastMonth.slice(0, 7)}):     ${formatCurrency(lastMonthTotal)}`);
console.log(`This Month (${currentMonth}):     ${formatCurrency(currentMonthTotal)} (${daysElapsed} days)`);
console.log(`Projected Monthly:        ${formatCurrency(projectedMonthly)}`);
console.log(`Daily Average:            ${formatCurrency(currentMonthTotal / daysElapsed)}/day`);
console.log();

// ============================================================================
// Cost by Service
// ============================================================================

console.log("┌────────────────────────────────────────────────────────────────┐");
console.log("│ COST BY SERVICE (This Month)                                   │");
console.log("└────────────────────────────────────────────────────────────────┘");

const serviceData = runAwsCommand(
  `get-cost-and-usage --time-period Start=${firstOfMonth},End=${tomorrow} --granularity MONTHLY --metrics "UnblendedCost" --group-by Type=DIMENSION,Key=SERVICE`
);

const services: Array<{ name: string; cost: number }> = [];
for (const group of serviceData.ResultsByTime[0]?.Groups ?? []) {
  const cost = parseFloat(group.Metrics.UnblendedCost.Amount);
  if (cost > 0) {
    services.push({ name: group.Keys[0], cost });
  }
}

services.sort((a, b) => b.cost - a.cost);

const maxServiceNameLen = Math.max(...services.map((s) => s.name.length), 30);
let serviceTotal = 0;

for (const svc of services) {
  const pct = currentMonthTotal > 0 ? (svc.cost / currentMonthTotal) * 100 : 0;
  const bar = "█".repeat(Math.round(pct / 2));
  console.log(
    `${svc.name.padEnd(maxServiceNameLen)} ${formatCurrency(svc.cost).padStart(10)} ${pct.toFixed(1).padStart(5)}% ${bar}`
  );
  serviceTotal += svc.cost;
}

console.log("─".repeat(maxServiceNameLen + 30));
console.log(`${"TOTAL".padEnd(maxServiceNameLen)} ${formatCurrency(serviceTotal).padStart(10)}`);
console.log();

// ============================================================================
// Daily Trend (Last 7 Days)
// ============================================================================

console.log("┌────────────────────────────────────────────────────────────────┐");
console.log("│ DAILY TREND (Last 7 Days)                                      │");
console.log("└────────────────────────────────────────────────────────────────┘");

const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
const dailyData = runAwsCommand(
  `get-cost-and-usage --time-period Start=${weekAgo},End=${tomorrow} --granularity DAILY --metrics "UnblendedCost"`
);

let maxDailyCost = 0;
const dailyCosts: Array<{ date: string; cost: number }> = [];

for (const day of dailyData.ResultsByTime) {
  const cost = parseFloat(day.Total?.UnblendedCost.Amount ?? "0");
  dailyCosts.push({ date: day.TimePeriod.Start, cost });
  if (cost > maxDailyCost) maxDailyCost = cost;
}

for (const day of dailyCosts) {
  const barLen = maxDailyCost > 0 ? Math.round((day.cost / maxDailyCost) * 30) : 0;
  const bar = "█".repeat(barLen);
  console.log(`${day.date}  ${formatCurrency(day.cost).padStart(10)}  ${bar}`);
}

console.log();

// ============================================================================
// Cost Optimization Recommendations
// ============================================================================

console.log("┌────────────────────────────────────────────────────────────────┐");
console.log("│ COST OPTIMIZATION RECOMMENDATIONS                              │");
console.log("└────────────────────────────────────────────────────────────────┘");

const recommendations: string[] = [];

// Check for high-cost services
const domainCost = services.find((s) => s.name.includes("Registrar"))?.cost ?? 0;
if (domainCost > 10) {
  recommendations.push(`✓ Domain registration ($${domainCost.toFixed(2)}) is a one-time annual cost - expected.`);
}

const secretsCost = services.find((s) => s.name.includes("Secrets Manager"))?.cost ?? 0;
if (secretsCost > 0.1) {
  recommendations.push(
    `⚠ Secrets Manager ($${secretsCost.toFixed(2)}): Consider using SSM Parameter Store for non-sensitive config (free tier available).`
  );
}

const s3Cost = services.find((s) => s.name.includes("S3") || s.name.includes("Storage"))?.cost ?? 0;
if (s3Cost > 1) {
  recommendations.push(
    `⚠ S3 Storage ($${s3Cost.toFixed(2)}): Review bucket lifecycle policies, enable Intelligent-Tiering for infrequent access.`
  );
}

const lambdaCost = services.find((s) => s.name.includes("Lambda"))?.cost ?? 0;
if (lambdaCost === 0) {
  recommendations.push(`✓ Lambda is within free tier (1M requests/month, 400K GB-seconds) - excellent!`);
}

const apiGwCost = services.find((s) => s.name.includes("API Gateway"))?.cost ?? 0;
if (apiGwCost < 1) {
  recommendations.push(`✓ API Gateway ($${apiGwCost.toFixed(2)}) - low traffic costs, within expected range.`);
}

const dynamoCost = services.find((s) => s.name.includes("DynamoDB"))?.cost ?? 0;
if (dynamoCost < 0.01) {
  recommendations.push(`✓ DynamoDB ($${dynamoCost.toFixed(4)}) - on-demand pricing efficient for current usage.`);
}

// Overall assessment
const monthlyProjection = projectedMonthly;
if (monthlyProjection < 5) {
  recommendations.push(`\n✓ OVERALL: Projected monthly cost (${formatCurrency(monthlyProjection)}) is very low!`);
} else if (monthlyProjection < 20) {
  recommendations.push(`\n✓ OVERALL: Projected monthly cost (${formatCurrency(monthlyProjection)}) is reasonable for a production app.`);
} else if (monthlyProjection < 50) {
  recommendations.push(`\n⚠ OVERALL: Projected monthly cost (${formatCurrency(monthlyProjection)}) - review high-cost services above.`);
} else {
  recommendations.push(`\n❌ OVERALL: Projected monthly cost (${formatCurrency(monthlyProjection)}) needs optimization!`);
}

for (const rec of recommendations) {
  console.log(rec);
}

console.log();

// ============================================================================
// Infrastructure Summary
// ============================================================================

console.log("┌────────────────────────────────────────────────────────────────┐");
console.log("│ INFRASTRUCTURE SUMMARY                                         │");
console.log("└────────────────────────────────────────────────────────────────┘");

console.log(`
Services in use:
  • Lambda Functions     - Serverless compute (trading rounds, API)
  • API Gateway          - HTTP API for routes
  • DynamoDB             - Fast key-value storage for rounds
  • Secrets Manager      - API keys and credentials
  • S3                   - Asset storage, CDK artifacts
  • Route 53             - DNS management
  • ECR                  - Docker image registry
  • CloudWatch           - Logs and monitoring

Pricing Model:
  • Lambda: Free tier (1M requests, 400K GB-sec)
  • API Gateway: $1.00 per million requests
  • DynamoDB: On-demand ($1.25/M write, $0.25/M read)
  • Secrets Manager: $0.40/secret/month + $0.05/10K requests
  • S3: ~$0.023/GB/month + request charges
`);

console.log("═".repeat(68));
console.log(`Report generated: ${now.toISOString()}`);
console.log("═".repeat(68));
