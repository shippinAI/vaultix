import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { anonymousMcpSessionRule, authenticatedAppSessionRule } from "./mcp-session-contract";

const contract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../../contracts/vaultix.core.v1.json"), "utf8")
) as {
  paths: { "/mcp": { post: { summary: string; description: string } } };
};

describe("Vaultix MCP session contract", () => {
  test("the published contract matches the router session rule", () => {
    const { post } = contract.paths["/mcp"];
    expect(post.summary).not.toMatch(/^Stateless JSON-RPC/);
    expect(post.description).toContain(anonymousMcpSessionRule);
    expect(post.description).toContain(authenticatedAppSessionRule);
    expect(post.description).toContain("No secret values");
  });
});
