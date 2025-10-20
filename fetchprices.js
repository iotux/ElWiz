#!/usr/bin/env node

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function resolveCli() {
  try {
    return require.resolve("elwiz-prices/bin/elwiz-prices.js");
  } catch (error) {
    console.error(
      "Unable to locate elwiz-prices CLI. Make sure the dependency is installed (npm install elwiz-prices).",
    );
    process.exit(1);
  }
}

function resolveConfig(fileName) {
  const candidate = path.resolve(__dirname, fileName);
  return fs.existsSync(candidate) ? candidate : null;
}

function main() {
  const cliPath = resolveCli();
  const extraArgs = process.argv.slice(2);

  const resolvedPriceConfig = resolveConfig("price-config.yaml");
  const resolvedAppConfig = resolveConfig("config.yaml");

  const args = [cliPath];
  if (resolvedPriceConfig) {
    args.push(resolvedPriceConfig);
    if (resolvedAppConfig) {
      args.push(resolvedAppConfig);
    }
  }
  args.push(...extraArgs);

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error("Failed to execute elwiz-prices:", error.message);
    process.exit(1);
  });
}

main();
