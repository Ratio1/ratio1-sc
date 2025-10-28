#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function readReport(filePath) {
  if (!filePath) {
    throw new Error("Missing report file path");
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Gas report not found at ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return data;
}

function collectMethods(report) {
  const map = new Map();
  const methods = report?.data?.methods || {};
  for (const value of Object.values(methods)) {
    const contract = value.contract || "Unknown";
    const methodName = value.method || value.fnSig || value.key;
    const key = `${contract}::${methodName}`;
    const calls = value.numberOfCalls ?? (Array.isArray(value.gasData) ? value.gasData.length : 0);
    const avg = typeof value.executionGasAverage === "number"
      ? value.executionGasAverage
      : Array.isArray(value.gasData) && value.gasData.length > 0
        ? Math.round(value.gasData.reduce((sum, gas) => sum + gas, 0) / value.gasData.length)
        : undefined;
    map.set(key, {
      key,
      contract,
      method: methodName,
      avg,
      calldataAvg: typeof value.calldataGasAverage === "number" ? value.calldataGasAverage : undefined,
      calls,
    });
  }
  return map;
}

function collectDeployments(report) {
  const map = new Map();
  const deployments = report?.data?.deployments || [];
  for (const deployment of deployments) {
    const name = deployment.name || "Unknown";
    const avg = typeof deployment.executionGasAverage === "number"
      ? deployment.executionGasAverage
      : Array.isArray(deployment.gasData) && deployment.gasData.length > 0
        ? Math.round(deployment.gasData.reduce((sum, gas) => sum + gas, 0) / deployment.gasData.length)
        : undefined;
    const calls = Array.isArray(deployment.gasData) ? deployment.gasData.length : 0;
    map.set(name, {
      key: name,
      name,
      avg,
      calldataAvg: typeof deployment.calldataGasAverage === "number" ? deployment.calldataGasAverage : undefined,
      calls,
    });
  }
  return map;
}

function formatNumber(value) {
  if (value === undefined || value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatDelta(base, pr) {
  if (base === undefined && pr === undefined) {
    return "—";
  }
  if (base === undefined) {
    return `+${formatNumber(pr)}`;
  }
  if (pr === undefined) {
    return `-${formatNumber(base)}`;
  }
  const delta = pr - base;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatNumber(delta)}`;
}

function formatPercent(base, pr) {
  if (base === undefined || base === 0 || pr === undefined) {
    return "—";
  }
  const delta = ((pr - base) / base) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}%`;
}

function formatCalls(baseCalls, prCalls) {
  const baseVal = baseCalls ?? 0;
  const prVal = prCalls ?? 0;
  if (baseVal === prVal) {
    return `${prVal}`;
  }
  return `${baseVal}→${prVal}`;
}

function computeDiffs(baseMap, prMap, accessor) {
  const keys = new Set([...baseMap.keys(), ...prMap.keys()]);
  const rows = [];
  let baseTotal = 0;
  let prTotal = 0;
  for (const key of keys) {
    const base = baseMap.get(key);
    const pr = prMap.get(key);
    const baseAvg = base?.avg;
    const prAvg = pr?.avg;
    const baseCalls = base?.calls;
    const prCalls = pr?.calls;
    if (typeof baseAvg === "number" && typeof baseCalls === "number") {
      baseTotal += baseAvg * Math.max(baseCalls, 1);
    }
    if (typeof prAvg === "number" && typeof prCalls === "number") {
      prTotal += prAvg * Math.max(prCalls, 1);
    }
    const item = accessor(base, pr);
    item.baseAvg = baseAvg;
    item.prAvg = prAvg;
    item.baseCalls = baseCalls ?? 0;
    item.prCalls = prCalls ?? 0;
    let delta;
    if (prAvg === undefined && baseAvg === undefined) {
      delta = undefined;
    } else if (baseAvg === undefined) {
      delta = prAvg;
    } else if (prAvg === undefined) {
      delta = -baseAvg;
    } else {
      delta = prAvg - baseAvg;
    }
    item.delta = delta;
    rows.push(item);
  }
  return { rows, baseTotal, prTotal };
}

function buildTable(rows, options = {}) {
  const { includeCalls = true } = options;
  const header = includeCalls
    ? ["Contract", "Method", "Calls (base→PR)", "Base Avg Gas", "PR Avg Gas", "Δ Gas", "Δ %"]
    : ["Contract", "Base Avg Gas", "PR Avg Gas", "Δ Gas", "Δ %"];
  const lines = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    if (includeCalls) {
      lines.push(
        `| ${row.contract} | ${row.method} | ${formatCalls(row.baseCalls, row.prCalls)} | ${formatNumber(row.baseAvg)} | ${formatNumber(row.prAvg)} | ${formatDelta(row.baseAvg, row.prAvg)} | ${formatPercent(row.baseAvg, row.prAvg)} |`
      );
    } else {
      lines.push(
        `| ${row.contract} | ${formatNumber(row.baseAvg)} | ${formatNumber(row.prAvg)} | ${formatDelta(row.baseAvg, row.prAvg)} | ${formatPercent(row.baseAvg, row.prAvg)} |`
      );
    }
  }
  return lines.join("\n");
}

function filterTopChanges(rows, limit = 15) {
  const sorted = [...rows].sort((a, b) => {
    const aDelta = a.delta === undefined ? 0 : Math.abs(a.delta);
    const bDelta = b.delta === undefined ? 0 : Math.abs(b.delta);
    return bDelta - aDelta;
  });
  return sorted
    .filter((row) => row.delta !== undefined && row.delta !== 0)
    .slice(0, limit);
}

function buildSummary(title, baseTotal, prTotal) {
  const delta = prTotal - baseTotal;
  const percent = baseTotal === 0 ? undefined : ((prTotal - baseTotal) / baseTotal) * 100;
  const formattedDelta = delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(Math.round(delta))}`;
  const formattedPercent = percent === undefined ? "—" : `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
  return `- **${title}:** ${new Intl.NumberFormat("en-US").format(Math.round(baseTotal))} → ${new Intl.NumberFormat("en-US").format(Math.round(prTotal))} (${formattedDelta}, ${formattedPercent})`;
}

function main() {
  const args = parseArgs(process.argv);
  const basePath = args.base;
  const prPath = args.pr;
  const outputPath = args.out || "gas-report-comment.md";
  const baseSha = args.baseSha || "";
  const prSha = args.prSha || "";

  const baseReport = readReport(basePath);
  const prReport = readReport(prPath);

  const { rows: methodRows, baseTotal: methodBaseTotal, prTotal: methodPrTotal } = computeDiffs(
    collectMethods(baseReport),
    collectMethods(prReport),
    (base, pr) => ({
      contract: pr?.contract || base?.contract || "Unknown",
      method: pr?.method || base?.method || (pr?.key ?? base?.key ?? "Unknown"),
    })
  );

  methodRows.sort((a, b) => {
    const contractComparison = (a.contract || "").localeCompare(b.contract || "");
    if (contractComparison !== 0) {
      return contractComparison;
    }
    return (a.method || "").localeCompare(b.method || "");
  });

  const { rows: deploymentRows, baseTotal: deploymentBaseTotal, prTotal: deploymentPrTotal } = computeDiffs(
    collectDeployments(baseReport),
    collectDeployments(prReport),
    (base, pr) => ({
      contract: pr?.name || base?.name || "Unknown",
      method: pr?.name || base?.name || "Unknown",
    })
  );

  deploymentRows.sort((a, b) => (a.contract || "").localeCompare(b.contract || ""));

  const topMethodChanges = filterTopChanges(methodRows);
  const topDeploymentChanges = filterTopChanges(deploymentRows, 10);

  const lines = [];
  lines.push("<!-- gas-report -->");
  lines.push("## Gas usage comparison");
  lines.push("");
  if (baseSha) {
    lines.push(`Base commit: \`${baseSha.slice(0, 7)}\``);
  }
  if (prSha) {
    lines.push(`PR commit: \`${prSha.slice(0, 7)}\``);
  }
  if (baseSha || prSha) {
    lines.push("");
  }
  lines.push("### Summary");
  lines.push(buildSummary("Method gas total", methodBaseTotal, methodPrTotal));
  lines.push(buildSummary("Deployment gas total", deploymentBaseTotal, deploymentPrTotal));
  lines.push("");

  lines.push("### Largest method changes");
  if (topMethodChanges.length === 0) {
    lines.push("No significant method gas differences detected.");
  } else {
    lines.push(buildTable(topMethodChanges));
  }
  lines.push("");

  lines.push("### Deployment changes");
  if (topDeploymentChanges.length === 0) {
    lines.push("No deployment gas differences detected.");
  } else {
    const deploymentTableRows = topDeploymentChanges.map((row) => ({
      contract: row.contract,
      baseAvg: row.baseAvg,
      prAvg: row.prAvg,
      delta: row.delta,
    }));
    lines.push(buildTable(deploymentTableRows, { includeCalls: false }));
  }
  lines.push("");

  if (methodRows.length > topMethodChanges.length) {
    lines.push("<details><summary>All method measurements</summary>\n");
    lines.push(buildTable(methodRows));
    lines.push("\n</details>");
    lines.push("");
  }

  if (deploymentRows.length > topDeploymentChanges.length) {
    lines.push("<details><summary>All deployments</summary>\n");
    const fullDeploymentRows = deploymentRows.map((row) => ({
      contract: row.contract,
      baseAvg: row.baseAvg,
      prAvg: row.prAvg,
      delta: row.delta,
    }));
    lines.push(buildTable(fullDeploymentRows, { includeCalls: false }));
    lines.push("\n</details>");
    lines.push("");
  }

  fs.writeFileSync(path.resolve(outputPath), `${lines.join("\n")}\n`, "utf8");
}

main();
