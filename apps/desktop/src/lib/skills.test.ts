import { describe, expect, it } from "vitest";
import {
  filterAllowedSkills,
  formatSkillsSystemHint,
  isBuiltinSkill,
  type SkillDefinition,
} from "@/lib/skills";

function skill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return {
    id: "agents:demo",
    name: "demo",
    description: "A local skill",
    source: "agents",
    path: "/tmp/demo/SKILL.md",
    content: "do the thing",
    ...overrides,
  };
}

describe("isBuiltinSkill", () => {
  it("detects builtin source and id prefix", () => {
    expect(isBuiltinSkill({ source: "builtin", id: "builtin:chatdesk-doc" })).toBe(true);
    expect(isBuiltinSkill({ source: "agents", id: "builtin:chatdesk-doc" })).toBe(true);
    expect(isBuiltinSkill(skill({}))).toBe(false);
  });
});

describe("filterAllowedSkills", () => {
  it("keeps all skills when none are disabled", () => {
    const demo = skill({});
    const other = skill({ id: "agents:other", name: "other" });
    expect(filterAllowedSkills([demo, other], [])).toEqual([demo, other]);
  });

  it("omits globally disabled skills", () => {
    const demo = skill({});
    const other = skill({ id: "agents:other", name: "other" });
    expect(filterAllowedSkills([demo, other], ["agents:demo"])).toEqual([other]);
  });
});

describe("formatSkillsSystemHint", () => {
  it("omits builtin skills from the injected local skill body", () => {
    const hint = formatSkillsSystemHint([
      skill({
        id: "builtin:chatdesk-doc",
        name: "chatdesk-doc",
        source: "builtin",
        content: "secret",
      }),
      skill({}),
    ]);
    expect(hint).toContain("do the thing");
    expect(hint).not.toContain("secret");
    expect(hint).not.toContain("chatdesk-doc");
  });
});
