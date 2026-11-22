import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const local = join(root, ".toolchain");
const forgeStd = join(root, "lib", "forge-std");
const commit = "77041d2ce690e692d6e03cc812b57d1ddaa4d505";
const binaries = "https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages";
const compiler = process.platform === "darwin"
  ? ["macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a", "81515b0e53deaa266d549545ccaac0a5a96e6d4e8201c77f673b2c710976d9ea"]
  : process.platform === "linux" && process.arch === "x64"
    ? ["linux-amd64/solc-linux-amd64-v0.8.28+commit.7893614a", "9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25"]
    : undefined;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function download(url, digest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dependency download returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== digest) throw new Error("Dependency checksum did not match.");
  return bytes;
}

await mkdir(local, { recursive: true });
const solc = join(local, "solc");
if (compiler) {
  const [path, digest] = compiler;
  const installed = await readFile(solc).catch(() => undefined);
  if (!installed || sha256(installed) !== digest) await writeFile(solc, await download(`${binaries}/${path}`, digest));
  await chmod(solc, 0o755);
} else {
  const version = spawnSync(solc, ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || !version.stdout.includes("0.8.28+commit.7893614a")) {
    throw new Error("Install a native Solidity 0.8.28 binary at contracts/.toolchain/solc, then retry.");
  }
}

const marker = join(forgeStd, ".movenotice-pin");
if (await readFile(marker, "utf8").catch(() => "") !== commit) {
  const archive = join(local, "forge-std.tar.gz");
  const staged = join(local, "forge-std-staged");
  const url = `https://codeload.github.com/foundry-rs/forge-std/tar.gz/${commit}`;
  const digest = "a387f7c2a10387f889b0d18b999cfa667a5273ac11cc11e18923022eb8b24bc3";
  await writeFile(archive, await download(url, digest));
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  const unpack = spawnSync("tar", ["-xzf", archive, "--strip-components=1", "-C", staged]);
  if (unpack.status !== 0) throw new Error("Could not unpack forge-std.");
  await writeFile(join(staged, ".movenotice-pin"), commit);
  await mkdir(join(root, "lib"), { recursive: true });
  await rm(forgeStd, { recursive: true, force: true });
  await rename(staged, forgeStd);
  await rm(archive, { force: true });
}
console.log("Solidity 0.8.28 and forge-std v1.9.7 are ready.");
