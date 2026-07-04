import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const reportPath = path.join(root, "security-precheck-report.txt");

const ignoreDirs = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
  ".next",
  ".cache",
  "coverage",
]);

const allowedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".toml",
  ".env",
  ".example",
  ".prisma",
  ".md",
  ".mjs",
]);

const secretPatterns = [
  ["Shopify app secret token", /\bshpss_[A-Za-z0-9_]+\b/g],
  ["Shopify access token", /\bshpat_[A-Za-z0-9_]+\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z\-_]{20,}\b/g],
  ["Private key block", /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/g],
  ["Possible database URL with credentials", /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi],
];

const secretEnvNames = [
  "SHOPIFY_API_SECRET",
  "SHOPIFY_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "SESSION_SECRET",
];

function walk(dir, files = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(item.name)) continue;

    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      walk(full, files);
      continue;
    }

    const ext = path.extname(item.name);

    if (!allowedExtensions.has(ext) && !item.name.includes(".env")) {
      continue;
    }

    const stat = fs.statSync(full);

    if (stat.size > 5 * 1024 * 1024) {
      continue;
    }

    files.push(full);
  }

  return files;
}

function rel(file) {
  return path.relative(root, file);
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function addSection(lines, title) {
  lines.push("");
  lines.push(`## ${title}`);
}

function checkTrackedEnvFiles(lines) {
  addSection(lines, "1. Git tracked environment files");

  try {
    const tracked = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((file) => /(^|\/)\.env($|\.|\/)/.test(file))
      .filter((file) => !file.endsWith(".env.example"));

    if (tracked.length) {
      lines.push("Status: FAIL");
      lines.push("Problem: A real environment file is tracked by Git.");
      lines.push("");

      for (const file of tracked) {
        lines.push(`- Tracked env-like file: ${file}`);
      }

      lines.push("");
      lines.push("Action: Remove it from Git tracking before pushing.");
    } else {
      lines.push("Status: PASS");
      lines.push("- No real .env files are tracked by Git.");
      lines.push("- .env.example is okay to track if it contains placeholder values only.");
    }
  } catch {
    lines.push("Status: WARN");
    lines.push("- Could not run git ls-files.");
  }
}

function checkSecretPatterns(lines, files) {
  addSection(lines, "2. Hardcoded secret pattern scan");

  const findings = [];

  for (const file of files) {
    const relative = rel(file);

    if (relative === "security-precheck-report.txt") continue;

    const text = readText(file);

    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;

      let match;

      while ((match = pattern.exec(text))) {
        findings.push(`- REVIEW: ${label} found at ${relative}:${lineNumber(text, match.index)}`);
      }
    }

    if (relative.endsWith(".env") || relative.includes(".env.")) {
      const linesInFile = text.split("\n");

      linesInFile.forEach((line, index) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) return;

        for (const envName of secretEnvNames) {
          if (trimmed.startsWith(`${envName}=`)) {
            const value = trimmed.split("=").slice(1).join("=").trim();

            if (
              value &&
              !value.includes("your_") &&
              !value.includes("example") &&
              !value.includes("placeholder") &&
              value !== ""
            ) {
              findings.push(`- REVIEW: ${envName} has a value at ${relative}:${index + 1}`);
            }
          }
        }
      });
    }
  }

  if (!findings.length) {
    lines.push("Status: PASS");
    lines.push("- No obvious hardcoded secrets found by this scan.");
  } else {
    lines.push("Status: REVIEW");
    lines.push("These are not printed for safety. Review the files/lines manually.");
    lines.push("");
    lines.push(...findings);
  }
}

function checkEventEndpoint(lines) {
  addSection(lines, "3. Event endpoint security precheck");

  const eventRoute = path.join(root, "app/routes/api.events.track.tsx");

  if (!fs.existsSync(eventRoute)) {
    lines.push("Status: FAIL");
    lines.push("- app/routes/api.events.track.tsx not found.");
    return;
  }

  const text = readText(eventRoute);

  const hasImport = text.includes("event-security.server");
  const hasCall = text.includes("applyEventSecurityPrecheck(request");

  if (hasImport && hasCall) {
    lines.push("Status: PASS");
    lines.push("- Event route uses applyEventSecurityPrecheck().");
  } else {
    lines.push("Status: FAIL");
    lines.push("- Event route does not use applyEventSecurityPrecheck().");
  }
}

function checkSecurityHelper(lines) {
  addSection(lines, "4. Event security helper file");

  const helper = path.join(root, "app/services/security/event-security.server.ts");

  if (!fs.existsSync(helper)) {
    lines.push("Status: FAIL");
    lines.push("- app/services/security/event-security.server.ts not found.");
    return;
  }

  const text = readText(helper);

  const checks = [
    ["applyEventSecurityPrecheck", text.includes("applyEventSecurityPrecheck")],
    ["sanitizeForEventLog", text.includes("sanitizeForEventLog")],
    ["ALLOWED_EVENTS", text.includes("ALLOWED_EVENTS")],
    ["checkPurchasePayload", text.includes("checkPurchasePayload")],
    ["checkRateLimit", text.includes("checkRateLimit")],
  ];

  const failed = checks.filter(([, ok]) => !ok);

  if (!failed.length) {
    lines.push("Status: PASS");
    lines.push("- Event security helper exists with required functions.");
  } else {
    lines.push("Status: FAIL");
    for (const [name] of failed) {
      lines.push(`- Missing: ${name}`);
    }
  }
}

function checkLogRisk(lines, files) {
  addSection(lines, "5. Event log / raw payload risk scan");

  const riskyFiles = [];

  for (const file of files) {
    const relative = rel(file);

    if (!relative.startsWith("app/")) continue;

    const text = readText(file);

    const mentionsLogs =
      text.includes("eventDeliveryLog") ||
      text.includes("EventDeliveryLog") ||
      text.includes("deliveryLog");

    const mentionsRawPayload =
      text.includes("rawPayload") ||
      text.includes("requestPayload") ||
      text.includes("responseBody") ||
      text.includes("payloadJson") ||
      /payload\s*:/i.test(text);

    const usesSafeLogService =
      text.includes("createEventDeliveryLog") &&
      fs.existsSync(path.join(root, "app/services/event-delivery-log.server.ts")) &&
      readText(path.join(root, "app/services/event-delivery-log.server.ts")).includes("sanitizeTrackingEvent") &&
      readText(path.join(root, "app/services/event-delivery-log.server.ts")).includes("sanitizeForEventLog");

    const hasSanitizer =
      text.includes("sanitizeForEventLog") ||
      text.includes("[redacted-secret]") ||
      text.includes("[redacted-address]") ||
      usesSafeLogService;

    if (mentionsLogs && mentionsRawPayload && !hasSanitizer) {
      riskyFiles.push(relative);
    }
  }

  if (!riskyFiles.length) {
    lines.push("Status: PASS");
    lines.push("- No obvious unredacted event log risk found by this scan.");
  } else {
    lines.push("Status: REVIEW");
    lines.push("Review these files and make sure raw payloads are sanitized before saving:");
    lines.push("");

    for (const file of [...new Set(riskyFiles)]) {
      lines.push(`- ${file}`);
    }
  }
}

function checkPrivacyWebhooks(lines, files) {
  addSection(lines, "6. Shopify privacy webhook check");

  const allText = files.map((file) => readText(file)).join("\n");

  const requiredTopics = [
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ];

  const missing = requiredTopics.filter((topic) => !allText.includes(topic));

  if (!missing.length) {
    lines.push("Status: PASS");
    lines.push("- Required privacy webhook topic strings were found.");
  } else {
    lines.push("Status: REVIEW");
    lines.push("These privacy webhook topics were not detected:");
    lines.push("");

    for (const topic of missing) {
      lines.push(`- ${topic}`);
    }

    lines.push("");
    lines.push("Action: Before production, confirm these mandatory Shopify compliance webhooks exist.");
  }
}

function checkGitignore(lines) {
  addSection(lines, "7. .gitignore security entries");

  const gitignore = path.join(root, ".gitignore");

  if (!fs.existsSync(gitignore)) {
    lines.push("Status: FAIL");
    lines.push("- .gitignore not found.");
    return;
  }

  const text = readText(gitignore);

  const required = [
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "security-precheck-report.txt",
  ];

  const missing = required.filter((entry) => !text.includes(entry));

  if (!missing.length) {
    lines.push("Status: PASS");
    lines.push("- Secret-safe .gitignore entries found.");
  } else {
    lines.push("Status: REVIEW");
    lines.push("Missing .gitignore entries:");
    lines.push("");

    for (const entry of missing) {
      lines.push(`- ${entry}`);
    }
  }
}

function checkGitStatus(lines) {
  addSection(lines, "8. Current Git change summary");

  try {
    const status = execSync("git status --short", { encoding: "utf8" }).trim();

    if (!status) {
      lines.push("Status: CLEAN");
      lines.push("- No local Git changes.");
      return;
    }

    lines.push("Status: REVIEW");
    lines.push("Local changes found:");
    lines.push("");

    for (const line of status.split("\n")) {
      lines.push(`- ${line}`);
    }
  } catch {
    lines.push("Status: WARN");
    lines.push("- Could not run git status.");
  }
}

const files = walk(root);
const lines = [];

lines.push("# DH Conversions Security Precheck Report");
lines.push(`Generated: ${new Date().toISOString()}`);

checkTrackedEnvFiles(lines);
checkSecretPatterns(lines, files);
checkEventEndpoint(lines);
checkSecurityHelper(lines);
checkLogRisk(lines, files);
checkPrivacyWebhooks(lines, files);
checkGitignore(lines);
checkGitStatus(lines);

lines.push("");
lines.push("# Summary");
lines.push("");
lines.push("PASS = Good.");
lines.push("REVIEW = Need manual check, not always an error.");
lines.push("FAIL = Fix before production/live-store installation.");

fs.writeFileSync(reportPath, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("");
console.log(`Report saved to: ${reportPath}`);
