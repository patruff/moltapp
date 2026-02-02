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
import { Construct } from "constructs";

export class MoltappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Secrets Manager ---
    const secret = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: "moltapp/production",
      description: "MoltApp production secrets",
    });

    // --- Lambda Function ---
    const fn = new nodejs.NodejsFunction(this, "ApiFunction", {
      entry: "../src/lambda.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: "production",
        SECRET_ARN: secret.secretArn,
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

    // --- API Gateway HTTP API ---
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      "LambdaIntegration",
      fn,
    );

    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      description: "MoltApp API",
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

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: ["patgpt.us"],
      certificate,
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
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
  }
}
