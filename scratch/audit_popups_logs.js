import fs from "fs";
import path from "path";

const POPUPS = [
  { regex: /\b(window\.)?confirm\s*\(/g, type: "confirm" },
  { regex: /\b(window\.)?alert\s*\(/g, type: "alert" },
  { regex: /\b(window\.)?prompt\s*\(/g, type: "prompt" }
];

const LOGS = /\bconsole\.log\s*\(/g;

const foundPopups = [];
const foundLogs = [];

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== "node_modules" && file !== ".git" && file !== "dist") {
        searchDir(fullPath);
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".mjs")) {
      // Skip scratch files
      if (fullPath.includes("scratch")) return;
      
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      
      lines.forEach((line, idx) => {
        POPUPS.forEach((p) => {
          if (p.regex.test(line)) {
            // Filter false positives like comment lines
            if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
              foundPopups.push({
                file: fullPath,
                line: idx + 1,
                content: line.trim(),
                type: p.type
              });
            }
          }
        });
        
        if (LOGS.test(line)) {
          if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
            foundLogs.push({
              file: fullPath,
              line: idx + 1,
              content: line.trim()
            });
          }
        }
      });
    }
  });
}

searchDir("src");
searchDir("functions");

console.log("=== POPUPS AUDIT ===");
foundPopups.forEach((p) => {
  console.log(`[${p.type.toUpperCase()}] ${p.file}:${p.line} -> ${p.content}`);
});

console.log("\n=== LOGS AUDIT (Sample or potentially sensitive ones) ===");
foundLogs.forEach((l) => {
  const c = l.content.toLowerCase();
  // Highlight logs that print variables, objects, passwords, tokens, credentials, codes, or secrets
  if (
    c.includes("pass") || 
    c.includes("token") || 
    c.includes("key") || 
    c.includes("secret") || 
    c.includes("auth") || 
    c.includes("code") || 
    c.includes("user") || 
    c.includes("employee") || 
    c.includes("payload") ||
    c.includes("res") ||
    c.includes("data")
  ) {
    console.log(`[LOG] ${l.file}:${l.line} -> ${l.content}`);
  }
});
