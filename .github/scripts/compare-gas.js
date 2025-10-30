#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const istanbul = require("sc-istanbul");

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

function normalizeCoveragePath(filePath, rootDir) {
  if (!filePath) {
    return "Unknown";
  }

  const normalizedRoot = rootDir ? path.resolve(rootDir) : undefined;
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : normalizedRoot
      ? path.resolve(normalizedRoot, filePath)
      : path.resolve(filePath);

  if (normalizedRoot) {
    const relative = path.relative(normalizedRoot, resolvedPath);
    if (relative && !relative.startsWith("..")) {
      return relative.replace(/\\/g, "/");
    }
  }

  return resolvedPath.replace(/\\/g, "/");
}

function readCoverageReport(filePath, rootDir) {
  if (!filePath) {
    return null;
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Coverage report not found at ${resolved}`);
  }

  const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const summary = istanbul.utils.summarizeCoverage(raw);
  const files = Object.keys(raw).map((key) => {
    const fileCoverage = raw[key] || {};
    const coveragePath = fileCoverage.path || key;
    return {
      file: normalizeCoveragePath(coveragePath, rootDir),
      summary: istanbul.utils.summarizeFileCoverage(fileCoverage),
    };
  });

  return {
    summary,
    files,
  };
}

function getCoverageMetric(summary, key) {
  if (!summary || typeof summary !== "object") {
    return { pct: undefined, covered: 0, total: 0 };
  }
  const metric = summary[key];
  if (!metric || typeof metric !== "object") {
    return { pct: undefined, covered: 0, total: 0 };
  }
  const total = typeof metric.total === "number" ? metric.total : 0;
  const pct = total === 0 || typeof metric.pct !== "number" || !Number.isFinite(metric.pct) ? undefined : metric.pct;
  return {
    pct,
    covered: typeof metric.covered === "number" ? metric.covered : 0,
    total,
  };
}

function formatCoverageValue(metric) {
  if (!metric) {
    return "—";
  }

  const pct = metric.pct;
  const covered = metric.covered ?? 0;
  const total = metric.total ?? 0;
  const pctText = typeof pct === "number" ? `${pct.toFixed(2)}%` : "—";
  return `${pctText} (${covered}/${total})`;
}

function computeCoverageDeltaValue(baseMetric, prMetric) {
  const basePct = baseMetric?.pct;
  const prPct = prMetric?.pct;
  if (typeof basePct === "number" && typeof prPct === "number") {
    return prPct - basePct;
  }
  if (typeof prPct === "number") {
    return prPct;
  }
  if (typeof basePct === "number") {
    return -basePct;
  }
  return 0;
}

function formatCoverageDelta(baseMetric, prMetric) {
  const delta = computeCoverageDeltaValue(baseMetric, prMetric);
  if (delta === 0) {
    return "±0.00 pp";
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)} pp`;
}

function formatCoverageCoveredDelta(baseMetric, prMetric) {
  const baseCovered = baseMetric?.covered ?? 0;
  const prCovered = prMetric?.covered ?? 0;
  const delta = prCovered - baseCovered;
  if (delta === 0) {
    return "±0 covered";
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} covered`;
}

function buildCoverageSummaryLines(baseSummary, prSummary) {
  const metrics = [
    { key: "statements", label: "Statements" },
    { key: "branches", label: "Branches" },
    { key: "functions", label: "Functions" },
    { key: "lines", label: "Lines" },
  ];

  return metrics.map(({ key, label }) => {
    const baseMetric = getCoverageMetric(baseSummary, key);
    const prMetric = getCoverageMetric(prSummary, key);
    return `- **${label}:** ${formatCoverageValue(baseMetric)} → ${formatCoverageValue(prMetric)} (${formatCoverageDelta(baseMetric, prMetric)}, ${formatCoverageCoveredDelta(baseMetric, prMetric)})`;
  });
}

function computeCoverageDiffRows(baseReport, prReport) {
  if (!baseReport && !prReport) {
    return [];
  }

  const baseMap = new Map();
  for (const entry of baseReport?.files || []) {
    baseMap.set(entry.file, entry);
  }

  const rows = [];

  for (const entry of prReport?.files || []) {
    const baseEntry = baseMap.get(entry.file);
    baseMap.delete(entry.file);
    rows.push({
      file: entry.file,
      baseMetric: getCoverageMetric(baseEntry?.summary, "statements"),
      prMetric: getCoverageMetric(entry.summary, "statements"),
    });
  }

  for (const [file, entry] of baseMap.entries()) {
    rows.push({
      file,
      baseMetric: getCoverageMetric(entry.summary, "statements"),
      prMetric: getCoverageMetric(null, "statements"),
    });
  }

  return rows
    .map((row) => {
      const delta = computeCoverageDeltaValue(row.baseMetric, row.prMetric);
      return {
        ...row,
        baseText: formatCoverageValue(row.baseMetric),
        prText: formatCoverageValue(row.prMetric),
        deltaText: formatCoverageDelta(row.baseMetric, row.prMetric),
        absoluteDelta: Math.abs(delta),
      };
    })
    .sort((a, b) => {
      if (b.absoluteDelta !== a.absoluteDelta) {
        return b.absoluteDelta - a.absoluteDelta;
      }
      return a.file.localeCompare(b.file);
    });
}

function buildCoverageTable(rows) {
  if (!rows || rows.length === 0) {
    return "";
  }

  const header = "| File | Base (stmts) | PR (stmts) | Δ (pp) |";
  const separator = "| --- | --- | --- | --- |";
  const body = rows.map((row) => `| ${row.file} | ${row.baseText} | ${row.prText} | ${row.deltaText} |`);
  return [header, separator, ...body].join("\n");
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
  const filteredRows = rows.filter((row) => row.baseAvg !== undefined || row.prAvg !== undefined);
  if (filteredRows.length === 0) {
    return null;
  }
  const header = includeCalls
    ? ["Contract", "Method", "Calls (base→PR)", "Base Avg Gas", "PR Avg Gas", "Δ Gas", "Δ %"]
    : ["Contract", "Base Avg Gas", "PR Avg Gas", "Δ Gas", "Δ %"];
  const lines = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of filteredRows) {
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
  const coverageBasePath = args.coverageBase;
  const coveragePrPath = args.coveragePr;
  const coverageBaseRoot = args.coverageBaseRoot ? path.resolve(args.coverageBaseRoot) : undefined;
  const coveragePrRoot = args.coveragePrRoot ? path.resolve(args.coveragePrRoot) : undefined;

  const baseReport = readReport(basePath);
  const prReport = readReport(prPath);

  let baseCoverage = null;
  let prCoverage = null;
  if (coverageBasePath && coveragePrPath) {
    baseCoverage = readCoverageReport(coverageBasePath, coverageBaseRoot);
    prCoverage = readCoverageReport(coveragePrPath, coveragePrRoot);
  }

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
  if (baseSha) {
    lines.push(`Base commit: \`${baseSha.slice(0, 7)}\``);
  }
  if (prSha) {
    lines.push(`PR commit: \`${prSha.slice(0, 7)}\``);
  }
  if (baseSha || prSha) {
    lines.push("");
  }

  lines.push("## Test coverage comparison");
  lines.push("");
  if (baseCoverage && prCoverage) {
    lines.push("### Summary");
    lines.push(...buildCoverageSummaryLines(baseCoverage.summary, prCoverage.summary));
    lines.push("");

    const allCoverageRows = computeCoverageDiffRows(baseCoverage, prCoverage);
    const significantCoverageRows = allCoverageRows.filter((row) => row.absoluteDelta > 0.01);

    lines.push("### Largest coverage changes (statements)");
    if (significantCoverageRows.length === 0) {
      lines.push("No coverage percentage differences detected.");
      const fullCoverageTable = buildCoverageTable(allCoverageRows);
      if (fullCoverageTable) {
        lines.push("");
        lines.push("<details><summary>All file coverage</summary>\n");
        lines.push(fullCoverageTable);
        lines.push("\n</details>");
      }
      lines.push("");
    } else {
      const topCoverageTable = buildCoverageTable(significantCoverageRows.slice(0, 10));
      if (topCoverageTable) {
        lines.push(topCoverageTable);
        lines.push("");
      }

      if (allCoverageRows.length > significantCoverageRows.length) {
        const fullCoverageTable = buildCoverageTable(allCoverageRows);
        if (fullCoverageTable) {
          lines.push("<details><summary>All file coverage</summary>\n");
          lines.push(fullCoverageTable);
          lines.push("\n</details>");
          lines.push("");
        }
      }
    }
  } else {
    lines.push("Coverage data not available.");
    lines.push("");
  }

  lines.push("## Gas usage comparison");
  lines.push("");
  lines.push("### Summary");
  lines.push(buildSummary("Method gas total", methodBaseTotal, methodPrTotal));
  lines.push(buildSummary("Deployment gas total", deploymentBaseTotal, deploymentPrTotal));
  lines.push("");

  lines.push("### Largest method changes");
  const topMethodsTable = buildTable(topMethodChanges);
  if (!topMethodsTable) {
    lines.push("No significant method gas differences detected.");
  } else {
    lines.push(topMethodsTable);
  }
  lines.push("");

  lines.push("### Deployment changes");
  const topDeploymentTable = buildTable(
    topDeploymentChanges.map((row) => ({
      contract: row.contract,
      baseAvg: row.baseAvg,
      prAvg: row.prAvg,
      delta: row.delta,
    })),
    { includeCalls: false }
  );
  if (!topDeploymentTable) {
    lines.push("No deployment gas differences detected.");
  } else {
    lines.push(topDeploymentTable);
  }
  lines.push("");

  const allMethodsTable = buildTable(methodRows);
  if (allMethodsTable && methodRows.length > topMethodChanges.length) {
    lines.push("<details><summary>All method measurements</summary>\n");
    lines.push(allMethodsTable);
    lines.push("\n</details>");
    lines.push("");
  }

  if (deploymentRows.length > topDeploymentChanges.length) {
    const fullDeploymentsTable = buildTable(
      deploymentRows.map((row) => ({
        contract: row.contract,
        baseAvg: row.baseAvg,
        prAvg: row.prAvg,
        delta: row.delta,
      })),
      { includeCalls: false }
    );
    if (fullDeploymentsTable) {
      lines.push("<details><summary>All deployments</summary>\n");
      lines.push(fullDeploymentsTable);
      lines.push("\n</details>");
      lines.push("");
    }
  }

  fs.writeFileSync(path.resolve(outputPath), `${lines.join("\n")}\n`, "utf8");
}

main();
