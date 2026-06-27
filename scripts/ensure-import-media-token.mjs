#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

const KEY = "VITE_IMPORT_MEDIA_UPLOAD_TOKEN";
const FALLBACK_KEY = "IMPORT_MEDIA_TOKEN";
const targetFiles = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
].map((file) => path.resolve(file));
const sourceFiles = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env",
].map((file) => path.resolve(file));

const parseEnvValue = (text, key) => {
  const line = text
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
};

const readEnvValue = (file, key) => {
  try {
    return parseEnvValue(fs.readFileSync(file, "utf8"), key);
  } catch {
    return "";
  }
};

const findToken = () => {
  const fromEnv = (process.env[KEY] || process.env[FALLBACK_KEY] || "").trim();
  if (fromEnv) return fromEnv;

  for (const file of sourceFiles) {
    const value = readEnvValue(file, KEY) || readEnvValue(file, FALLBACK_KEY);
    if (value) return value;
  }

  return "";
};

const upsertEnvFile = (file, token) => {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }

  const lines = text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith(`${KEY}=`) && !trimmed.startsWith(`${FALLBACK_KEY}=`);
    });
  lines.push(`${KEY}=${token}`);
  lines.push(`${FALLBACK_KEY}=${token}`);
  const next = `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
};

const token = findToken();

if (!token) {
  console.error(
    [
      `Missing ${KEY}.`,
      "Set it in your shell or ignored .env.local before running dev/build:",
      `${KEY}=<same value as metadata-worker IMPORT_MEDIA_TOKEN>`,
    ].join("\n")
  );
  process.exit(1);
}

for (const file of targetFiles) {
  upsertEnvFile(file, token);
}

console.log(`${KEY} is configured for dev and production builds.`);
