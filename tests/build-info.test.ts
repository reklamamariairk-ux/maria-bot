import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getBuildInfo } from "../src/build-info";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maria-build-info-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.8.7" }));
  fs.writeFileSync(path.join(root, "public", "game.html"), "game-v1");
  return root;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("build-info", () => {
  it("читает package version и commit из окружения", () => {
    const info = getBuildInfo(fixture(), { RENDER_GIT_COMMIT: "ABCDEF0123456789" });
    expect(info.version).toBe("9.8.7");
    expect(info.commit).toBe("abcdef0123456789");
    expect(info.artifact).toMatch(/^sha256-[a-f0-9]{16}$/);
  });

  it("читает commit из обычного .git checkout", () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/master\n");
    fs.writeFileSync(path.join(root, ".git", "refs", "heads", "master"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(getBuildInfo(root, {}).commit).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("даёт стабильный fingerprint даже без git metadata", () => {
    const root = fixture();
    const first = getBuildInfo(root, {});
    expect(first.commit).toBe("unavailable");
    expect(getBuildInfo(root, {}).artifact).toBe(first.artifact);
    fs.writeFileSync(path.join(root, "public", "game.html"), "game-v2");
    expect(getBuildInfo(root, {}).artifact).not.toBe(first.artifact);
  });
});
