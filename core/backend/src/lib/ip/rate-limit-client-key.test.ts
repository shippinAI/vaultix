import { describe, expect, it } from "vitest";

import { rateLimitClientKey } from "./index";

describe("rateLimitClientKey", () => {
  it("counts an IPv4 client by its address", () => {
    expect(rateLimitClientKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("counts every address in an IPv6 /64 as one client", () => {
    const key = rateLimitClientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(key).toBe("2001:db8:1:2::/64");
    expect(rateLimitClientKey("2001:db8:1:2::1")).toBe(key);
    expect(rateLimitClientKey("2001:0DB8:0001:0002:0:0:0:ffff")).toBe(key);
  });

  it("keeps different /64 networks apart", () => {
    expect(rateLimitClientKey("2001:db8:1:3::1")).not.toBe(rateLimitClientKey("2001:db8:1:2::1"));
  });

  it("handles compressed forms at either end", () => {
    expect(rateLimitClientKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitClientKey("2001:db8::")).toBe("2001:db8:0:0::/64");
  });

  it("ignores a zone and keeps an IPv4-mapped client distinct", () => {
    expect(rateLimitClientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitClientKey("::ffff:203.0.113.9")).toBe("::ffff:203.0.113.9");
  });
});
