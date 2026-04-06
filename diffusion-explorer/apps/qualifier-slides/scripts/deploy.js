import { execSync } from "child_process";
import fs from "fs-extra";
import path from "path";

const { copySync, removeSync } = fs;

const mainRepoUrl = "https://github.com/helblazer811/helblazer811.github.io.git";
const tempDir = path.resolve("./temp-main-repo");
const buildDir = path.resolve("./build");
const targetDir = path.join(tempDir, "blog/qualifier-slides");

try {
  console.log("Cloning main website repo...");
  execSync(`git clone ${mainRepoUrl} ${tempDir}`, { stdio: "inherit" });

  console.log("Cleaning old blog/qualifier-slides...");
  removeSync(targetDir);

  console.log("Copying new build...");
  copySync(buildDir, targetDir);

  console.log("Committing and pushing...");
  execSync(
    `cd ${tempDir} && git add blog/qualifier-slides && git commit -m "Update qualifier-slides" && git push`,
    { stdio: "inherit" }
  );

  console.log("Cleaning up temp folder...");
  removeSync(tempDir);

  console.log("Deploy complete!");
} catch (err) {
  console.error("Deploy failed:", err);
  process.exit(1);
}
