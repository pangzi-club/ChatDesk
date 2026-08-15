import { describe, expect, it } from "vitest";
import {
  filterChatCommands,
  findActiveCommandQuery,
  findActiveCommandTrigger,
} from "./chat-commands.ts";

describe("findActiveCommandQuery", () => {
  it("triggers at the start of the input", () => {
    expect(findActiveCommandQuery("/", 1)).toBe("");
    expect(findActiveCommandQuery("/te", 3)).toBe("te");
  });

  it("triggers when the slash follows whitespace", () => {
    expect(findActiveCommandQuery("hello /", 7)).toBe("");
    expect(findActiveCommandQuery("hello /tes", 10)).toBe("tes");
    expect(findActiveCommandQuery("hello\n/", 7)).toBe("");
  });

  it("does not trigger without leading whitespace", () => {
    expect(findActiveCommandQuery("hello/", 6)).toBeNull();
  });

  it("does not trigger after a space ends the command", () => {
    expect(findActiveCommandQuery("hello / ", 8)).toBeNull();
    expect(findActiveCommandQuery("/test 更多", 8)).toBeNull();
  });

  it("only reads text before the caret", () => {
    expect(findActiveCommandQuery("/test", 2)).toBe("t");
    expect(findActiveCommandQuery("abc /def", 4)).toBeNull();
  });
});

describe("findActiveCommandTrigger", () => {
  it("reports the slash position in the full text", () => {
    expect(findActiveCommandTrigger("hello /te", 9)).toEqual({ start: 6, query: "te" });
    expect(findActiveCommandTrigger("/", 1)).toEqual({ start: 0, query: "" });
    expect(findActiveCommandTrigger("hello/", 6)).toBeNull();
  });
});

describe("filterChatCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterChatCommands("").map((command) => command.name)).toEqual(["/test"]);
  });

  it("filters by prefix with or without the leading slash", () => {
    expect(filterChatCommands("te").map((command) => command.name)).toEqual(["/test"]);
    expect(filterChatCommands("/test").map((command) => command.name)).toEqual(["/test"]);
    expect(filterChatCommands("/x")).toEqual([]);
  });
});
