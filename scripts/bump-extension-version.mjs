import { readFile, writeFile } from "node:fs/promises";

const packageJsonPath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = String(packageJson.version ?? "");
const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

if (!match) {
  throw new Error(`Expected package.json version to be x.y.z, received "${version}".`);
}

const [, major, minor, patch] = match;
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;

packageJson.version = nextVersion;

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(nextVersion);
