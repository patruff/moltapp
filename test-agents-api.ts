/**
 * Agent API Endpoint Test Script
 *
 * Quick smoke test to verify all /api/v1/agents endpoints work correctly.
 * Run with: bun run test-agents-api.ts
 */

const BASE_URL = "http://localhost:3000/api/v1";

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  success: boolean;
  error?: string;
  responseTime?: number;
}

const results: TestResult[] = [];

async function testEndpoint(
  method: string,
  path: string,
  expectedStatus = 200
): Promise<TestResult> {
  const endpoint = `${BASE_URL}${path}`;
  const startTime = Date.now();

  try {
    const response = await fetch(endpoint, { method });
    const responseTime = Date.now() - startTime;
    const status = response.status;
    const success = status === expectedStatus;

    // Try to parse JSON to verify response format
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      await response.json(); // Consume response
    }

    return {
      endpoint: path,
      method,
      status,
      success,
      responseTime,
    };
  } catch (error) {
    return {
      endpoint: path,
      method,
      status: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

async function runTests() {
  console.log("🧪 Testing MoltApp Agent API Endpoints...\n");

  // Test 1: List all agents
  console.log("1️⃣  Testing GET /agents");
  const test1 = await testEndpoint("GET", "/agents");
  results.push(test1);
  console.log(
    test1.success
      ? `✅ PASS (${test1.responseTime}ms)`
      : `❌ FAIL (status: ${test1.status}, error: ${test1.error})`
  );

  // Test 2: Get specific agent (Claude)
  console.log("\n2️⃣  Testing GET /agents/:agentId (claude-value-investor)");
  const test2 = await testEndpoint("GET", "/agents/claude-value-investor");
  results.push(test2);
  console.log(
    test2.success
      ? `✅ PASS (${test2.responseTime}ms)`
      : `❌ FAIL (status: ${test2.status}, error: ${test2.error})`
  );

  // Test 3: Get agent trades
  console.log("\n3️⃣  Testing GET /agents/:agentId/trades");
  const test3 = await testEndpoint(
    "GET",
    "/agents/claude-value-investor/trades?limit=10"
  );
  results.push(test3);
  console.log(
    test3.success
      ? `✅ PASS (${test3.responseTime}ms)`
      : `❌ FAIL (status: ${test3.status}, error: ${test3.error})`
  );

  // Test 4: Get agent portfolio
  console.log("\n4️⃣  Testing GET /agents/:agentId/portfolio");
  const test4 = await testEndpoint(
    "GET",
    "/agents/claude-value-investor/portfolio"
  );
  results.push(test4);
  console.log(
    test4.success
      ? `✅ PASS (${test4.responseTime}ms)`
      : `❌ FAIL (status: ${test4.status}, error: ${test4.error})`
  );

  // Test 5: Get on-chain portfolios
  console.log("\n5️⃣  Testing GET /agents/portfolios/on-chain");
  const test5 = await testEndpoint("GET", "/agents/portfolios/on-chain");
  results.push(test5);
  console.log(
    test5.success
      ? `✅ PASS (${test5.responseTime}ms)`
      : `❌ FAIL (status: ${test5.status}, error: ${test5.error})`
  );

  // Test 6: Invalid agent ID (should return 404)
  console.log("\n6️⃣  Testing GET /agents/:agentId (invalid ID, expect 404)");
  const test6 = await testEndpoint("GET", "/agents/invalid-agent-id", 404);
  results.push(test6);
  console.log(
    test6.success
      ? `✅ PASS (${test6.responseTime}ms)`
      : `❌ FAIL (status: ${test6.status}, expected 404)`
  );

  // Summary
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const avgResponseTime = Math.round(
    results.reduce((sum, r) => sum + (r.responseTime || 0), 0) / results.length
  );

  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Summary");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);
  console.log(`⏱️  Average Response Time: ${avgResponseTime}ms`);

  if (failed > 0) {
    console.log("\n❌ Failed Tests:");
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(
          `  - ${r.method} ${r.endpoint} (status: ${r.status}, error: ${r.error})`
        );
      });
  }

  console.log("\n" + "=".repeat(60));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((err) => {
  console.error("\n💥 Test runner crashed:", err);
  process.exit(1);
});
