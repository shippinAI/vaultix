// Headless CLI against the loopback API and the seeded database.
// Configured SSO is covered by the local issuer tests. This process does not contact a live issuer.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import dotenv from "dotenv";
// Test harness only. tsconfig-paths is already a backend devDependency.
// eslint-disable-next-line import/no-extraneous-dependencies
import { register } from "tsconfig-paths";

register({
  baseUrl: path.resolve(__dirname, ".."),
  paths: { "@app/*": ["src/*"], "@bdd_routes/*": ["src/server/routes/bdd/*"] }
});

const backend = path.resolve(__dirname, "..");
const root = path.resolve(backend, "../..");
const envPath = path.resolve(backend, "../.env.test");
dotenv.config({ path: envPath });

const loopback = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`${label} is missing`);
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`${label} is not loopback`);
  return value;
};

const siteURL = loopback(process.env.SITE_URL, "SITE_URL");
loopback(process.env.DB_CONNECTION_URI, "DB_CONNECTION_URI");
loopback(process.env.REDIS_URL, "REDIS_URL");
delete process.env.NOMEN_OIDC_ISSUER;

const privateDir = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vaultix-cli-"));
  return directory;
};

const run = async () => {
  const { seedData1 } = await import("../src/db/seed-data");
  const secrets = [
    seedData1.password,
    seedData1.machineIdentity.clientCredentials.secret,
    process.env.DB_CONNECTION_URI ?? "",
    process.env.ENCRYPTION_KEY ?? "",
    process.env.AUTH_SECRET ?? ""
  ].filter((value) => value.length > 0);
  const redact = (text: string) => secrets.reduce((current, secret) => current.split(secret).join("[redacted]"), text);

  const serverEnv = { ...process.env, HOST: "127.0.0.1", PORT: "8200", NOMEN_OIDC_ISSUER: "" };
  let serverLog = "";
  const server: ChildProcess = spawn(path.resolve(backend, "node_modules/tsx/dist/cli.mjs"), ["src/main.ts"], {
    cwd: backend,
    env: serverEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const collect = (chunk: Buffer) => {
    serverLog += chunk.toString();
    if (serverLog.length > 200_000) serverLog = serverLog.slice(-100_000);
  };
  server.stdout?.on("data", collect);
  server.stderr?.on("data", collect);
  const stopServer = () => {
    if (!server.pid) return;
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  };

  const cli = (home: string, args: string[], input: string, extraEnv: Record<string, string> = {}) =>
    new Promise<{ status: number; output: string }>((resolvePromise) => {
      const child = spawn(path.join(tmpdir(), "vaultix-local-itest"), args, {
        env: {
          ...process.env,
          VAULTIX_HOME: home,
          VAULTIX_TOKEN: "",
          VAULTIX_TOKEN_FILE: "",
          NOMEN_OIDC_ISSUER: "",
          ...extraEnv
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on("close", (status) => resolvePromise({ status: status ?? 1, output }));
      child.stdin.end(input);
    });

  try {
    const built = spawn("go", ["build", "-o", path.join(tmpdir(), "vaultix-local-itest"), "./cmd/vaultix"], {
      cwd: root,
      stdio: "inherit"
    });
    await new Promise<void>((resolvePromise, reject) => {
      built.on("close", (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error("CLI build failed"));
      });
    });

    const deadline = Date.now() + 120_000;
    const waitForApi = async (): Promise<boolean> => {
      if (Date.now() >= deadline) return false;
      try {
        const response = await fetch(`${siteURL}/api/status`);
        if (response.status === 200) return true;
      } catch {
        // The server is still binding.
      }
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, 500);
      });
      return waitForApi();
    };
    if (!(await waitForApi())) throw new Error(`Loopback API did not become ready.\n${redact(serverLog).slice(-2000)}`);

    const request = async (urlPath: string, body: unknown) => {
      const response = await fetch(`${siteURL}${urlPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "vaultix-local-integration" },
        body: JSON.stringify(body)
      });
      return { status: response.status, text: await response.text() };
    };
    const assertClean = (output: string, label: string) => {
      if (secrets.some((secret) => output.includes(secret))) throw new Error(`${label} printed a credential`);
    };

    const rejectedPassword = await request("/api/v3/auth/login", {
      email: seedData1.email,
      password: "wrong-password-not-the-fixture"
    });
    if (rejectedPassword.status < 400) throw new Error(`wrong password was accepted: ${rejectedPassword.status}`);
    assertClean(rejectedPassword.text, "rejected password response");

    const passwordLogin = await request("/api/v3/auth/login", {
      email: seedData1.email,
      password: seedData1.password
    });
    if (passwordLogin.status !== 200 || !passwordLogin.text.includes("accessToken")) {
      throw new Error(`password login failed: ${passwordLogin.status} ${redact(passwordLogin.text).slice(0, 300)}`);
    }
    assertClean(passwordLogin.text, "password login response");

    const credentials = seedData1.machineIdentity.clientCredentials;
    const rejectedMachine = await request("/api/v1/auth/universal-auth/login", {
      clientId: credentials.id,
      clientSecret: "not-the-seed-secret"
    });
    if (rejectedMachine.status < 400) throw new Error(`wrong machine secret was accepted: ${rejectedMachine.status}`);
    assertClean(rejectedMachine.text, "rejected machine response");

    const machineLogin = await request("/api/v1/auth/universal-auth/login", {
      clientId: credentials.id,
      clientSecret: credentials.secret
    });
    if (machineLogin.status !== 200 || !machineLogin.text.includes("accessToken")) {
      throw new Error(`machine login failed: ${machineLogin.status} ${redact(machineLogin.text).slice(0, 300)}`);
    }
    assertClean(machineLogin.text, "machine login response");
    const machineToken = (JSON.parse(machineLogin.text) as { accessToken: string }).accessToken;
    secrets.push(machineToken);

    const ssoHome = privateDir();
    const started = Date.now();
    const missingIssuer = await cli(ssoHome, ["login", "--sso", "--api", siteURL], "", {
      NOMEN_OIDC_CLIENT_ID: "local-check"
    });
    rmSync(ssoHome, { recursive: true, force: true });
    if (
      missingIssuer.status === 0 ||
      !missingIssuer.output.includes("NOMEN_OIDC_ISSUER") ||
      Date.now() - started > 3000
    ) {
      throw new Error(`empty SSO issuer did not fail closed: ${redact(missingIssuer.output).slice(0, 300)}`);
    }

    const badHome = privateDir();
    const badCli = await cli(
      badHome,
      ["login", "--api", siteURL, "--universal", "--credential-file", path.join(badHome, "credential.json")],
      `${credentials.id}\nnot-the-seed-secret\n`
    );
    rmSync(badHome, { recursive: true, force: true });
    if (badCli.status === 0) throw new Error("CLI accepted a wrong machine secret");
    assertClean(badCli.output, "rejected CLI login");

    const home = privateDir();
    const credentialFile = path.join(home, "credential.json");
    const goodCli = await cli(
      home,
      ["login", "--api", siteURL, "--universal", "--credential-file", credentialFile],
      `${credentials.id}\n${credentials.secret}\n`
    );
    if (goodCli.status !== 0 || !goodCli.output.includes("(universal)")) {
      throw new Error(`CLI universal login failed: ${redact(goodCli.output).slice(0, 400)}`);
    }
    assertClean(goodCli.output, "CLI universal login");
    const mode = statSync(credentialFile).mode % 0o1000;
    if (mode !== 0o600) throw new Error(`credential file mode is ${mode.toString(8)}`);

    const tokenFile = path.join(home, "token.json");
    const tokenCli = await cli(
      home,
      ["login", "--api", siteURL, "--token", "--credential-file", tokenFile],
      `${machineToken}\n`
    );
    rmSync(home, { recursive: true, force: true });
    if (tokenCli.status !== 0 || !tokenCli.output.includes("(token)")) {
      throw new Error(`CLI token login failed: ${redact(tokenCli.output).slice(0, 400)}`);
    }
    assertClean(tokenCli.output, "CLI token login");
    process.stdout.write("Loopback password login, universal-auth login, and headless CLI token login passed.\n");
  } finally {
    stopServer();
  }
};

void run().catch((error) => {
  const message = error instanceof Error ? error.message : "local headless check failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
