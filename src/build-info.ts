import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface BuildInfo {
  version: string;
  commit: string;
  artifact: string;
}

function cleanCommit(value: string | undefined): string | null {
  const commit = value?.trim();
  return commit && /^[0-9a-f]{7,64}$/i.test(commit) ? commit.toLowerCase() : null;
}

function resolveGitDir(rootDir: string): string | null {
  const dotGit = path.join(rootDir, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const pointer = fs.readFileSync(dotGit, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(pointer);
    return match ? path.resolve(rootDir, match[1]) : null;
  } catch {
    return null;
  }
}

function readGitCommit(rootDir: string): string | null {
  const gitDir = resolveGitDir(rootDir);
  if (!gitDir) return null;
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const direct = cleanCommit(head);
    if (direct) return direct;
    const match = /^ref:\s*(refs\/[A-Za-z0-9._\/-]+)$/.exec(head);
    if (!match || match[1].includes("..")) return null;
    try {
      return cleanCommit(fs.readFileSync(path.join(gitDir, match[1]), "utf8"));
    } catch {
      const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
      for (const line of packed.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts[1] === match[1]) return cleanCommit(parts[0]);
      }
      return null;
    }
  } catch {
    return null;
  }
}

function readPackageVersion(rootDir: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

function artifactFingerprint(rootDir: string): string {
  const hash = crypto.createHash("sha256");
  let files = 0;
  for (const relative of ["package.json", "dist/index.js", "src/index.ts", "public/game.html"]) {
    try {
      hash.update(relative);
      hash.update(fs.readFileSync(path.join(rootDir, relative)));
      files++;
    } catch {
      // В production может не быть src, а в dev — свежего dist. Берём доступные артефакты.
    }
  }
  return files ? `sha256-${hash.digest("hex").slice(0, 16)}` : "unavailable";
}

export function getBuildInfo(
  rootDir = path.resolve(__dirname, ".."),
  env: NodeJS.ProcessEnv = process.env,
): BuildInfo {
  const commit = [env.RENDER_GIT_COMMIT, env.GIT_COMMIT, env.COMMIT_SHA, env.SOURCE_VERSION]
    .map(cleanCommit)
    .find((value): value is string => Boolean(value))
    ?? readGitCommit(rootDir)
    ?? "unavailable";

  return {
    version: env.npm_package_version?.trim() || readPackageVersion(rootDir),
    commit,
    artifact: artifactFingerprint(rootDir),
  };
}
