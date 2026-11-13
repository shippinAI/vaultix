import { parseIntegrationOrigins } from "./integration-origins";

describe("parseIntegrationOrigins", () => {
  test("unset or blank turns the feature off", () => {
    expect(parseIntegrationOrigins(undefined)).toEqual([]);
    expect(parseIntegrationOrigins("")).toEqual([]);
    expect(parseIntegrationOrigins("   ")).toEqual([]);
    expect(parseIntegrationOrigins("[]")).toEqual([]);
  });

  test("accepts exact https origins and loopback http origins", () => {
    expect(
      parseIntegrationOrigins(
        '["https://nomen.example.com", "https://id.example.com:8443", "http://127.0.0.1:18080", "http://localhost:5187", "http://[::1]:9000"]'
      )
    ).toEqual([
      "https://nomen.example.com",
      "https://id.example.com:8443",
      "http://127.0.0.1:18080",
      "http://localhost:5187",
      "http://[::1]:9000"
    ]);
  });

  test("drops duplicates", () => {
    expect(parseIntegrationOrigins('["https://a.example.com","https://a.example.com"]')).toEqual([
      "https://a.example.com"
    ]);
  });

  test.each([
    ["not JSON", "https://nomen.example.com"],
    ["not an array", '"https://nomen.example.com"'],
    ["an object", '{"origin":"https://nomen.example.com"}'],
    ["a non-string entry", "[42]"],
    ["a wildcard", '["*"]'],
    ["the null origin", '["null"]'],
    ["a trailing slash", '["https://nomen.example.com/"]'],
    ["a path", '["https://nomen.example.com/app"]'],
    ["a query", '["https://nomen.example.com?x=1"]'],
    ["upper case", '["https://Nomen.example.com"]'],
    ["a default port", '["https://nomen.example.com:443"]'],
    ["credentials", '["https://user@nomen.example.com"]'],
    ["plain http off loopback", '["http://nomen.example.com"]'],
    ["another scheme", '["ftp://nomen.example.com"]'],
    ["surrounding spaces", '[" https://nomen.example.com"]'],
    ["too many entries", JSON.stringify(Array.from({ length: 33 }, (_, i) => `https://n${i}.example.com`))]
  ])("refuses %s", (_name, raw) => {
    expect(() => parseIntegrationOrigins(raw)).toThrow(/VAULTIX_INTEGRATION_ORIGINS/);
  });
});
