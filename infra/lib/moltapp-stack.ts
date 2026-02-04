import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";

export class MoltappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Secrets Manager ---
    const secret = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: "moltapp/production",
      description: "MoltApp production secrets",
    });

    // --- DynamoDB Table for AI Agent State ---
    const agentStateTable = new dynamodb.Table(this, "AgentStateTable", {
      tableName: "moltapp-agent-state",
      partitionKey: { name: "agentId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: "ttl",
    });

    // GSI for querying recently active agents
    agentStateTable.addGlobalSecondaryIndex({
      indexName: "by-last-trade",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: {
        name: "lastTradeTimestamp",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- DynamoDB Table for Trading Round History ---
    const tradingRoundsTable = new dynamodb.Table(
      this,
      "TradingRoundsTable",
      {
        tableName: "moltapp-trading-rounds",
        partitionKey: { name: "roundId", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        timeToLiveAttribute: "ttl",
      },
    );

    // --- DynamoDB Table for $STONKS Lending State (Monad) ---
    const lendingStateTable = new dynamodb.Table(this, "LendingStateTable", {
      tableName: "moltapp-lending-state",
      partitionKey: { name: "loanId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
    });

    lendingStateTable.addGlobalSecondaryIndex({
      indexName: "by-borrower",
      partitionKey: {
        name: "borrowerId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    lendingStateTable.addGlobalSecondaryIndex({
      indexName: "by-status",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Lambda Function (API server) ---
    const fn = new nodejs.NodejsFunction(this, "ApiFunction", {
      entry: "../src/lambda.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512, // Reduced: API mostly proxies — 512MB is plenty for Hono
      timeout: cdk.Duration.seconds(30), // API requests shouldn't take 5 min
      environment: {
        NODE_ENV: "production",
        SECRET_ARN: secret.secretArn,
        AGENT_STATE_TABLE: agentStateTable.tableName,
        TRADING_ROUNDS_TABLE: tradingRoundsTable.tableName,
        LENDING_STATE_TABLE: lendingStateTable.tableName,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        banner:
          "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        minify: true,
        sourceMap: true,
        tsconfig: "../tsconfig.json",
        externalModules: [],
      },
    });
    secret.grantRead(fn);
    agentStateTable.grantReadWriteData(fn);
    tradingRoundsTable.grantReadWriteData(fn);
    lendingStateTable.grantReadWriteData(fn);

    // --- Trading Round Lambda (dedicated for scheduled trading) ---
    const tradingFn = new nodejs.NodejsFunction(this, "TradingFunction", {
      entry: "../src/lambda-trading.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024, // LLM calls are I/O-bound not CPU-bound — 1GB is enough
      timeout: cdk.Duration.minutes(5),
      environment: {
        NODE_ENV: "production",
        SECRET_ARN: secret.secretArn,
        AGENT_STATE_TABLE: agentStateTable.tableName,
        TRADING_ROUNDS_TABLE: tradingRoundsTable.tableName,
        LENDING_STATE_TABLE: lendingStateTable.tableName,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        banner:
          "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        minify: true,
        sourceMap: true,
        tsconfig: "../tsconfig.json",
        externalModules: [],
      },
    });
    secret.grantRead(tradingFn);
    agentStateTable.grantReadWriteData(tradingFn);
    tradingRoundsTable.grantReadWriteData(tradingFn);
    lendingStateTable.grantReadWriteData(tradingFn);

    // --- EventBridge Rule: Trigger trading every 30 minutes ---
    const tradingSchedule = new events.Rule(this, "TradingSchedule", {
      ruleName: "moltapp-trading-round",
      description:
        "Trigger AI trading round every 30 minutes — 3 agents compete",
      schedule: events.Schedule.cron({ minute: "0,30" }),
      enabled: true,
    });

    tradingSchedule.addTarget(
      new eventsTargets.LambdaFunction(tradingFn, {
        event: events.RuleTargetInput.fromObject({
          trigger: "scheduled-trading",
          source: "eventbridge-cron",
        }),
        retryAttempts: 2,
        maxEventAge: cdk.Duration.minutes(10),
      }),
    );

    // --- API Gateway HTTP API ---
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      "LambdaIntegration",
      fn,
    );

    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      description: "MoltApp API — AI Trading Competition Platform",
    });

    // Root route (/{proxy+} does NOT match /)
    httpApi.addRoutes({
      path: "/",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Catch-all route
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // --- Route53 + ACM ---
    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: "patgpt.us",
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: "patgpt.us",
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // --- CloudFront Distribution ---
    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
    );

    // Cache policy for GET endpoints (leaderboard, benchmark, brain-feed)
    // 60-second TTL balances freshness vs cost savings
    const shortCachePolicy = new cloudfront.CachePolicy(
      this,
      "ShortCachePolicy",
      {
        cachePolicyName: "moltapp-60s-cache",
        minTtl: cdk.Duration.seconds(0),
        defaultTtl: cdk.Duration.seconds(60),
        maxTtl: cdk.Duration.seconds(300),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior:
          cloudfront.CacheQueryStringBehavior.allowList(
            "page",
            "limit",
            "agent",
            "agentId",
            "format",
          ),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      },
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: ["patgpt.us"],
      certificate,
      // Default: no caching for POST/PUT/DELETE (trading, auth, etc.)
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      // Cache read-only benchmark/leaderboard endpoints (saves ~50% Lambda cost)
      additionalBehaviors: {
        "/api/v1/leaderboard*": {
          origin: apiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: shortCachePolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/api/v1/brain-feed*": {
          origin: apiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: shortCachePolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/benchmark*": {
          origin: apiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: shortCachePolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/api/v1/methodology*": {
          origin: apiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: shortCachePolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // --- Route53 A Record ---
    new route53.ARecord(this, "AliasRecord", {
      zone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain name",
    });

    new cdk.CfnOutput(this, "ApiGatewayUrl", {
      value: httpApi.apiEndpoint,
      description: "API Gateway HTTP API URL",
    });

    new cdk.CfnOutput(this, "CustomDomain", {
      value: "https://patgpt.us",
      description: "Custom domain URL",
    });

    new cdk.CfnOutput(this, "AgentStateTableName", {
      value: agentStateTable.tableName,
      description: "DynamoDB table for AI agent state",
    });

    new cdk.CfnOutput(this, "TradingRoundsTableName", {
      value: tradingRoundsTable.tableName,
      description: "DynamoDB table for trading round history",
    });

    new cdk.CfnOutput(this, "LendingStateTableName", {
      value: lendingStateTable.tableName,
      description: "DynamoDB table for $STONKS lending state",
    });

    new cdk.CfnOutput(this, "TradingScheduleArn", {
      value: tradingSchedule.ruleArn,
      description: "EventBridge rule ARN for scheduled trading",
    });
  }
}
