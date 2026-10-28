import { MutationCache, QueryClient } from "@tanstack/react-query";
import axios from "axios";

import { createNotification } from "@app/components/notifications";
import { showRequestErrorDetails } from "@app/components/notifications/RequestErrorDetails";
// akhilmhdh: doing individual imports to avoid cyclic import error
import { Badge } from "@app/components/v3/generic/Badge";
import { Button } from "@app/components/v3/generic/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3/generic/Table";
import {
  formatedConditionsOperatorNames,
  PermissionConditionOperators
} from "@app/context/ProjectPermissionContext/types";
import { formatValidationErrorPath } from "@app/lib/fn/permission";
import { camelCaseToSpaces } from "@app/lib/fn/string";

import { ApiErrorTypes, TApiErrors } from "./types";
// this is saved in react-query cache
export const SIGNUP_TEMP_TOKEN_CACHE_KEY = ["vaultix__signup-temp-token"];
export const MFA_TEMP_TOKEN_CACHE_KEY = ["vaultix__mfa-temp-token"];
export const AUTH_TOKEN_CACHE_KEY = ["vaultix__auth-token"];

export const onRequestError = (
  error: unknown,
  _variables?: unknown,
  _context?: unknown,
  mutation?: { meta?: Record<string, unknown> }
) => {
  if (axios.isAxiosError(error)) {
    const serverResponse = error.response?.data as TApiErrors;
    const handledErrorCodes = mutation?.meta?.handledErrorCodes;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (
      typeof serverResponse?.error === "string" &&
      Array.isArray(handledErrorCodes) &&
      handledErrorCodes.includes(serverResponse.error)
    ) {
      return;
    }

    if (serverResponse?.error === ApiErrorTypes.ValidationError) {
      if (mutation?.meta?.skipValidationToast) {
        return;
      }
      let requestBody: Record<string, unknown> | undefined;
      try {
        const configData = error.config?.data;
        requestBody =
          typeof configData === "string"
            ? JSON.parse(configData)
            : (configData as Record<string, unknown>);
      } catch {
        requestBody = undefined;
      }

      const issues = Array.isArray(serverResponse.message) ? serverResponse.message : [];
      const rows = issues
        .filter((issue) => Array.isArray(issue.path) && typeof issue.message === "string")
        .map(({ path, message }, index) => ({
          id: `${path.join(".")}:${index}`,
          field: formatValidationErrorPath(path, requestBody),
          message
        }));
      const toastId = createNotification({
        title: "Validation Error",
        type: "error",
        text: "Please check the input and try again.",
        copyActions: [
          {
            value: serverResponse.reqId,
            name: "Request ID",
            label: `Request ID: ${serverResponse.reqId}`
          }
        ]
      });
      showRequestErrorDetails({
        title: "Validation Error Details",
        description: "These fields did not pass validation.",
        toastId,
        returnFocus,
        content: (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Issue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ id, field, message }) => (
                <TableRow key={id}>
                  <TableCell className="whitespace-normal">{field}</TableCell>
                  <TableCell className="whitespace-normal">{message.toLowerCase()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      });
      return;
    }
    if (serverResponse?.error === ApiErrorTypes.ForbiddenError) {
      const details = (
        <div className="flex flex-col gap-2">
          {serverResponse.details?.map((el, index) => {
            const hasConditions = Boolean(Object.keys(el.conditions || {}).length);
            const actions = Array.isArray(el.action) ? el.action : [el.action];
            return (
              <div
                key={`Forbidden-error-details-${index + 1}`}
                className="rounded-md border border-border bg-card p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{el.inverted ? "Cannot" : "Can"}</span>
                  {actions.map((action, actionIndex) => (
                    <Badge
                      key={`Forbidden-error-details-${index + 1}-action-${actionIndex + 1}`}
                      variant={el.inverted ? "danger" : "success"}
                    >
                      {action.toString()}
                    </Badge>
                  ))}
                  <span>{el.subject.toString()}</span>
                  {hasConditions && <span className="text-muted">with conditions:</span>}
                </div>
                {hasConditions && (
                  <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">
                    {Object.keys(el.conditions || {}).flatMap((field, fieldIndex) => {
                      const operators = (
                        el.conditions as Record<
                          string,
                          string | { [K in PermissionConditionOperators]: string | string[] }
                        >
                      )[field];

                      const formattedFieldName = camelCaseToSpaces(field).toLowerCase();
                      if (typeof operators === "string") {
                        return (
                          <li key={`Forbidden-error-details-${index + 1}-${fieldIndex + 1}`}>
                            <span className="font-medium capitalize">{formattedFieldName}</span>{" "}
                            <span className="text-muted">equal to</span>{" "}
                            <Badge variant="neutral">{operators}</Badge>
                          </li>
                        );
                      }

                      return Object.keys(operators).map((operator, operatorIndex) => (
                        <li
                          key={`Forbidden-error-details-${index + 1}-${
                            fieldIndex + 1
                          }-${operatorIndex + 1}`}
                        >
                          <span className="font-medium capitalize">{formattedFieldName}</span>{" "}
                          <span className="text-muted">
                            {
                              formatedConditionsOperatorNames[
                                operator as PermissionConditionOperators
                              ]
                            }
                          </span>{" "}
                          <Badge variant="neutral">
                            {operators[operator as PermissionConditionOperators].toString()}
                          </Badge>
                        </li>
                      ));
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      );
      const toastId = createNotification({
        title: "Forbidden Access",
        type: "error",
        text: `${serverResponse.message}.`,
        callToAction: serverResponse?.details?.length ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              showRequestErrorDetails({
                title: "Validation Rules",
                description: "Please review the allowed rules below.",
                content: details,
                toastId,
                returnFocus
              })
            }
          >
            Show More
          </Button>
        ) : undefined,
        copyActions: [
          {
            value: serverResponse.reqId,
            name: "Request ID",
            label: `Request ID: ${serverResponse.reqId}`
          }
        ]
      });
      return;
    }
    const errorMessage =
      typeof serverResponse?.message === "string" && serverResponse.message
        ? serverResponse.message
        : "The request could not be completed. Please try again.";

    createNotification({
      title: "Bad Request",
      type: "error",
      text: `${errorMessage}${errorMessage.endsWith(".") ? "" : "."}`,
      copyActions: serverResponse?.reqId
        ? [
            {
              value: serverResponse.reqId,
              name: "Request ID",
              label: `Request ID: ${serverResponse.reqId}`
            }
          ]
        : undefined
    });
  }
};

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: onRequestError
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60_000 // 60s — prevents refetch on every component mount/remount
    }
  }
});

// memory token storage will be moved to apiRequest module until securityclient is completely depreciated
// then all the getters will be also hidden scoped to apiRequest only
const MemoryTokenStorage = () => {
  let authToken: string;

  return {
    setToken: (token: string) => {
      authToken = token;
    },
    getToken: () => authToken
  };
};

const signUpTempTokenStorage = MemoryTokenStorage();
const mfaAuthTokenStorage = MemoryTokenStorage();
const authTokenStorage = MemoryTokenStorage();

// set token in memory cache
export const setSignupTempToken = signUpTempTokenStorage.setToken;

export const setMfaTempToken = mfaAuthTokenStorage.setToken;

export const setAuthToken = authTokenStorage.setToken;

export const getSignupTempToken = signUpTempTokenStorage.getToken;
export const getMfaTempToken = mfaAuthTokenStorage.getToken;
export const getAuthToken = authTokenStorage.getToken;

export const isLoggedIn = () => Boolean(getAuthToken());
