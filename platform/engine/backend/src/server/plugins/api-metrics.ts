import { requestContext } from "@fastify/request-context";
import opentelemetry from "@opentelemetry/api";
import fp from "fastify-plugin";

import { RequestContextKey } from "@app/lib/request-context/request-context-keys";

const apiMeter = opentelemetry.metrics.getMeter("API");

const latencyHistogram = apiMeter.createHistogram("API_latency", {
  unit: "ms"
});

const vaultixMeter = opentelemetry.metrics.getMeter("Vaultix");

const requestCounter = vaultixMeter.createCounter("vaultix.http.server.request.count", {
  description: "Total number of API requests to Vaultix (covers both human users and machine identities)",
  unit: "{request}"
});

const requestDurationHistogram = vaultixMeter.createHistogram("vaultix.http.server.request.duration", {
  description: "API request latency",
  unit: "s"
});

export const apiMetrics = fp(async (fastify) => {
  fastify.addHook("onResponse", async (request, reply) => {
    const { method } = request;
    const route = request.routeOptions.url;
    const { statusCode } = reply;

    latencyHistogram.record(reply.elapsedTime, {
      route,
      method,
      statusCode
    });

    const orgId = requestContext.get(RequestContextKey.OrgId);
    const orgName = requestContext.get(RequestContextKey.OrgName);
    const userAuthInfo = requestContext.get(RequestContextKey.UserAuthInfo);
    const identityAuthInfo = requestContext.get(RequestContextKey.IdentityAuthInfo);
    const projectDetails = requestContext.get(RequestContextKey.ProjectDetails);
    const userAgent = requestContext.get(RequestContextKey.UserAgent);
    const ip = requestContext.get(RequestContextKey.Ip);

    const attributes: Record<string, string | number> = {
      "http.request.method": method,
      "http.route": route ?? "",
      "http.response.status_code": statusCode
    };

    if (orgId) {
      attributes["vaultix.organization.id"] = orgId;
    }
    if (orgName) {
      attributes["vaultix.organization.name"] = orgName;
    }

    if (userAuthInfo) {
      if (userAuthInfo.userId) {
        attributes["vaultix.user.id"] = userAuthInfo.userId;
      }
      if (userAuthInfo.email) {
        attributes["vaultix.user.email"] = userAuthInfo.email;
      }
    }

    if (identityAuthInfo) {
      if (identityAuthInfo.identityId) {
        attributes["vaultix.identity.id"] = identityAuthInfo.identityId;
      }
      if (identityAuthInfo.identityName) {
        attributes["vaultix.identity.name"] = identityAuthInfo.identityName;
      }
      if (identityAuthInfo.authMethod) {
        attributes["vaultix.auth.method"] = identityAuthInfo.authMethod;
      }
    }

    if (projectDetails) {
      if (projectDetails.id) {
        attributes["vaultix.project.id"] = projectDetails.id;
      }
      if (projectDetails.name) {
        attributes["vaultix.project.name"] = projectDetails.name;
      }
    }

    if (userAgent) {
      attributes["user_agent.original"] = userAgent;
    }

    if (ip) {
      attributes["client.address"] = ip;
    }

    requestCounter.add(1, attributes);
    requestDurationHistogram.record(reply.elapsedTime / 1000, attributes);
  });
});
