import { isAxiosError } from "axios";

import { BadRequestError } from "../errors";
import { logger } from "../logger";
import { GatewayTransportRequest, startGatewayTransport } from "./transport";
import { GatewayProxyProtocol, IGatewayProxyOptions, TPingGatewayAndVerifyDTO } from "./types";

const transportIdentity = ({ relayHost, relayPort, tlsOptions, identityId, orgId }: TPingGatewayAndVerifyDTO) => ({
  version: 1 as const,
  host: relayHost,
  ...(process.env.NODE_ENV === "development" && relayHost === "host.docker.internal"
    ? { serverName: "127.0.0.1" }
    : {}),
  port: relayPort,
  ...tlsOptions,
  identityId,
  orgId
});

export const pingGatewayAndVerify = async (options: TPingGatewayAndVerifyDTO) => {
  const maxRetries = options.maxRetries ?? 3;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) {
    throw new BadRequestError({ message: "Gateway ping requires between 1 and 10 attempts." });
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      // A failed connection is never reused for the next attempt.
      // eslint-disable-next-line no-await-in-loop
      const transport = await startGatewayTransport({ ...transportIdentity(options), mode: "ping" });
      // eslint-disable-next-line no-await-in-loop
      await transport.cleanup();
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxRetries) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 1_000);
        });
      }
    }
  }
  logger.error(lastError, "Gateway ping failed");
  throw new BadRequestError({ message: `Unable to reach and verify the gateway after ${maxRetries} attempts.` });
};

export const gatewayForwardCommand = ({
  targetHost,
  targetPort,
  protocol,
  httpsAgent
}: IGatewayProxyOptions): string => {
  if (targetHost && (/\s/.test(targetHost) || targetHost.includes(String.fromCharCode(0))))
    throw new BadRequestError({ message: "Invalid gateway target host." });
  if (targetPort !== undefined && (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)) {
    throw new BadRequestError({ message: "Invalid gateway target port." });
  }
  if (protocol === GatewayProxyProtocol.Tcp) {
    if (!targetHost || !targetPort)
      throw new BadRequestError({ message: "TCP forwarding requires a target host and port." });
    const host = targetHost.includes(":") && !targetHost.startsWith("[") ? `[${targetHost}]` : targetHost;
    return `FORWARD-TCP ${host}:${targetPort}\n`;
  }
  if (protocol !== GatewayProxyProtocol.Http)
    throw new BadRequestError({ message: "Unsupported gateway proxy protocol." });
  if (!targetHost && targetPort === undefined) return "FORWARD-HTTP\n";
  if (!targetHost || !targetPort || !/^https?:\/\//.test(targetHost)) {
    throw new BadRequestError({ message: "HTTP forwarding requires an HTTP(S) target and port." });
  }
  let command = `FORWARD-HTTP ${targetHost}:${targetPort}`;
  const agentOptions = httpsAgent?.options;
  if (targetHost.startsWith("https://") && agentOptions?.ca) {
    const ca = Array.isArray(agentOptions.ca) ? agentOptions.ca.join("\n") : agentOptions.ca;
    command += ` ca=${Buffer.from(ca).toString("base64")} verify=${agentOptions.rejectUnauthorized !== false}`;
  }
  return `${command}\n`;
};

export const withGatewayProxy = async <T>(
  callback: (port: number, httpsAgent?: IGatewayProxyOptions["httpsAgent"]) => Promise<T>,
  options: IGatewayProxyOptions
): Promise<T> => {
  const request: GatewayTransportRequest = {
    ...transportIdentity(options.relayDetails),
    mode: "proxy",
    command: gatewayForwardCommand(options)
  };
  const transport = await startGatewayTransport(request).catch((error: unknown) => {
    logger.error(error, "Gateway transport startup failed");
    throw new BadRequestError({ message: "Unable to connect to and verify the gateway." });
  });
  try {
    return await callback(transport.port, options.httpsAgent);
  } catch (error) {
    const transportError = transport.getError();
    if (transportError) logger.error(new Error(transportError), "Gateway transport failed");
    let message = transportError || (error instanceof Error ? error.message : "Gateway operation failed.");
    if (isAxiosError(error) && (error.response?.data as { message?: string })?.message) {
      message = (error.response?.data as { message: string }).message;
    }
    throw new BadRequestError({ message });
  } finally {
    await transport.cleanup();
  }
};
