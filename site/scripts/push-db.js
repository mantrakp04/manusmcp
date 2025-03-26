const { spawn } = require("child_process");
const path = require("path");

console.log("Pushing schema to database...");

// Use tsx to run the TypeScript file
const child = spawn("npx", ["tsx", path.join(__dirname, "../src/server/db/push.ts")], {
  stdio: "inherit",
});

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`Schema push failed with code ${code}`);
    process.exit(code || 1);
  }
  console.log("Schema push completed successfully!");
}); 