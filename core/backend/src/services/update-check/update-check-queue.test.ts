import { updateCheckServiceFactory } from "./update-check-queue";

const mocks = vi.hoisted(() => ({
  config: { VAULTIX_PLATFORM_VERSION: "1.0.0", VAULTIX_CLOUD: false, isCloud: false, DISABLE_UPDATE_CHECK: false },
  get: vi.fn(),
  register: vi.fn()
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => mocks.config }));
vi.mock("@app/lib/config/request", () => ({ request: { get: mocks.get } }));
vi.mock("@app/lib/logger", () => ({ logger: { debug: vi.fn() } }));
vi.mock("@app/shippin/services/license/license-fns", () => ({ getLicenseKeyConfig: () => ({ isValid: false }) }));
vi.mock("@app/keystore/keystore", () => ({
  KeyStorePrefixes: { UpdateCheckLatestVersion: "update-check-latest-version" },
  KeyStoreTtls: { UpdateCheckLatestVersionInSeconds: 1209600 }
}));
vi.mock("@app/lib/cron/cron-job", () => ({ CronJobName: { InstanceUpdateCheck: "instance-update-check" } }));

describe("owned release discovery", () => {
  const stable = {
    tag_name: "v2.0.0",
    draft: false,
    prerelease: false,
    published_at: "2026-10-31T12:00:00Z",
    html_url: "https://untrusted.invalid/"
  };
  const create = () => {
    const cache = new Map<string, string>();
    const keyStore = {
      getItem: vi.fn(async (key: string) => cache.get(key) ?? null),
      setItemWithExpiry: vi.fn(async (key: string, _ttl: number | string, value: string | number | Buffer) => {
        cache.set(key, String(value));
        return "OK" as const;
      })
    };
    const service = updateCheckServiceFactory({
      cronJob: { register: mocks.register },
      keyStore
    });
    return { service, cache, keyStore };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T13:00:00Z"));
    vi.clearAllMocks();
    Object.assign(mocks.config, {
      VAULTIX_PLATFORM_VERSION: "1.0.0",
      VAULTIX_CLOUD: false,
      isCloud: false,
      DISABLE_UPDATE_CHECK: false
    });
    mocks.get.mockResolvedValue({ status: 200, data: stable });
  });
  afterEach(() => vi.useRealTimers());

  test("reads never contact a release service; refresh uses owned destination and separate cache", async () => {
    const { service, cache, keyStore } = create();
    cache.set("update-check-latest-version", "999.0.0");
    expect((await service.getStatus()).state).toBe("unknown");
    expect(mocks.get).not.toHaveBeenCalled();
    await service.refresh();
    expect(await service.getStatus()).toMatchObject({
      state: "available",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      releaseUrl: "https://github.com/shippinAI/vaultix/releases/tag/v2.0.0"
    });
    expect(await service.getAvailableUpdateVersion()).toBe("2.0.0");
    expect(mocks.get).toHaveBeenCalledWith(
      "https://api.github.com/repos/shippinAI/vaultix/releases/latest",
      expect.objectContaining({
        timeout: 5000,
        maxContentLength: 65536,
        maxRedirects: 0,
        "axios-retry": { retries: 0 }
      })
    );
    expect(keyStore.getItem).not.toHaveBeenCalledWith("update-check-latest-version");
    await service.refresh();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  test.each(["disabled", "managed", "development"])("%s does not make outbound requests", async (state) => {
    if (state === "disabled") mocks.config.DISABLE_UPDATE_CHECK = true;
    if (state === "managed") mocks.config.isCloud = true;
    if (state === "development") mocks.config.VAULTIX_PLATFORM_VERSION = "dev-123456";
    const { service } = create();
    await service.refresh();
    expect((await service.getStatus()).state).toBe(state);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  test("outage and malformed metadata never mean current; a later check recovers", async () => {
    const { service } = create();
    mocks.get.mockRejectedValueOnce(new Error("CANARY-SECRET"));
    await service.refresh();
    expect((await service.getStatus()).state).toBe("unavailable");
    expect(await service.getAvailableUpdateVersion()).toBeNull();
    vi.advanceTimersByTime(60001);
    mocks.get.mockResolvedValueOnce({ status: 200, data: { ...stable, draft: true } });
    await service.refresh();
    expect((await service.getStatus()).state).toBe("unavailable");
    vi.advanceTimersByTime(60001);
    await service.refresh();
    expect((await service.getStatus()).state).toBe("available");
    expect(JSON.stringify(await service.getStatus())).not.toContain("CANARY");
  });

  test("no release, latest stable, prerelease ordering and cache failure have distinct results", async () => {
    mocks.config.VAULTIX_PLATFORM_VERSION = "2.0.0-rc.2";
    const { service, keyStore } = create();
    await service.refresh();
    expect((await service.getStatus()).state).toBe("available");
    mocks.config.VAULTIX_PLATFORM_VERSION = "2.0.0";
    const current = create();
    await current.service.refresh();
    expect((await current.service.getStatus()).state).toBe("current");
    vi.advanceTimersByTime(60001);
    mocks.get.mockResolvedValueOnce({ status: 404, data: {} });
    await service.refresh();
    expect((await service.getStatus()).state).toBe("unpublished");
    keyStore.getItem.mockRejectedValueOnce(new Error("cache unavailable"));
    expect((await service.getStatus()).state).toBe("unknown");
  });

  test("concurrent checks coalesce and do not install anything", async () => {
    let resolve!: (response: unknown) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { service } = create();
    const checks = Array.from({ length: 10 }, () => service.refresh());
    await Promise.resolve();
    await Promise.resolve();
    resolve({ status: 200, data: stable });
    await Promise.all(checks);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect((await service.getStatus()).state).toBe("available");
  });
});
