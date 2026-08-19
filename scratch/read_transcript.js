import fs from "fs";

const content = fs.readFileSync("C:\\Users\\Anuj\\.gemini\\antigravity-ide\\brain\\a5d8f3b7-f71f-43b1-9ce7-116e9685ff4c\\.system_generated\\logs\\transcript.jsonl", "utf8");
const lines = content.split("\n");

lines.forEach((line) => {
  if (!line.trim()) return;
  try {
    const obj = JSON.parse(line);
    const text = JSON.stringify(obj);
    if (text.includes("create-employee-user") && (text.includes("update-function") || text.includes("deploy") || text.includes("run_command"))) {
      console.log(`Step ${obj.step_index} (${obj.type}):`);
      if (obj.tool_calls) {
        console.log(JSON.stringify(obj.tool_calls, null, 2));
      } else {
        console.log(obj.content?.slice(0, 300));
      }
      console.log("---");
    }
  } catch (err) {
    // Ignore
  }
});
