import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProtectedPathPolicy, ProtectedPathError } from "./protected-paths.ts";

describe("protected file-tool paths", () => {
  it("protects the fixed home credential roots without matching repository lookalikes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-protected-paths-"));
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    await mkdir(home);
    await mkdir(workspace);
    const policy = createProtectedPathPolicy(home);

    for (const relativePath of [
      ".ssh/id_ed25519",
      ".SSH/missing",
      ".gnupg/private-keys-v1.d/key",
      ".aws/credentials",
      ".azure/accessTokens.json",
      ".kube/config",
      ".docker/config.json",
      ".config/gcloud/credentials.db",
      ".config/gh/hosts.yml",
      ".config/glab/config.yml",
      ".local/share/keyrings/login.keyring",
      "Library/Keychains/login.keychain-db",
      ".netrc",
      ".npmrc",
      ".pypirc",
      ".git-credentials",
      ".terraform.d/credentials.tfrc.json",
      ".config/containers/auth.json",
    ]) {
      expect(() => policy.assertReadable(path.join(home, relativePath))).toThrow(
        ProtectedPathError,
      );
      expect(() => policy.assertWritable(path.join(home, relativePath))).toThrow(
        ProtectedPathError,
      );
    }

    for (const relativePath of [".ssh/key.pub", ".docker/config.json", ".npmrc"]) {
      expect(policy.isReadable(path.join(workspace, relativePath))).toBe(true);
    }
    expect(policy.isReadable(path.join(home, ".ssh-backup", "key"))).toBe(true);
  });

  it("protects control directories from writes while preserving reads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-protected-controls-"));
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    await mkdir(home);
    await mkdir(workspace);
    const policy = createProtectedPathPolicy(home);

    for (const directory of [".git", ".GIT", ".agents", ".codex"]) {
      const target = path.join(workspace, "nested", directory, "config");
      expect(() => policy.assertWritable(target)).toThrow(ProtectedPathError);
      expect(() => policy.assertReadable(target)).not.toThrow();
    }
    expect(() =>
      policy.assertWritable(path.join(workspace, ".github", "workflow.yml")),
    ).not.toThrow();
  });

  it("checks canonical targets and canonicalized protected roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-protected-links-"));
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    const ssh = path.join(home, ".ssh");
    const credentialVault = path.join(root, "credential-vault");
    await mkdir(ssh, { recursive: true });
    await mkdir(workspace);
    await mkdir(credentialVault);
    await writeFile(path.join(ssh, "id_ed25519"), "secret", "utf8");
    await writeFile(path.join(credentialVault, "credentials"), "secret", "utf8");
    await symlink(ssh, path.join(workspace, "linked-ssh"));
    await symlink(credentialVault, path.join(home, ".aws"));
    const policy = createProtectedPathPolicy(home);

    expect(() => policy.assertReadable(path.join(workspace, "linked-ssh", "id_ed25519"))).toThrow(
      ProtectedPathError,
    );
    expect(() => policy.assertReadable(path.join(credentialVault, "credentials"))).toThrow(
      ProtectedPathError,
    );
    expect(policy.hasProtectedReadDescendant(home)).toBe(true);
    expect(policy.hasProtectedReadDescendant(workspace)).toBe(false);
  });
});
