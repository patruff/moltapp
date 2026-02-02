#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MoltappStack } from "../lib/moltapp-stack.js";

const app = new cdk.App();
new MoltappStack(app, "MoltappStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
});
