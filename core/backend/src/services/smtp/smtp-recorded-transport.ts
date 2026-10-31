import { createConnection, Socket } from "node:net";

import { createTransport } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";

import { RecordedMailError } from "./smtp-recorded-payload";

export const sendRecordedSmtp = (
  config: SMTPTransport.Options,
  message: SMTPTransport.MailOptions,
  signal?: AbortSignal
): Promise<SMTPTransport.SentMessageInfo> => {
  if (signal?.aborted) return Promise.reject(new RecordedMailError("retryable"));

  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: Socket | undefined;
    let connectionTimer: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let abort: () => void;
    const transport = createTransport({
      ...config,
      logger: false,
      debug: false,
      transactionLog: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      getSocket(
        options: SMTPTransport.Options,
        callback: (error: Error | null, value: false | { connection: Socket }) => void
      ) {
        if (settled) {
          callback(new RecordedMailError("uncertain"), false);
          return;
        }
        // Retain the TCP socket when Nodemailer wraps it for implicit TLS or
        // STARTTLS. Transport.close() alone does not stop an active send.
        try {
          socket = createConnection({
            host: options.host ?? "localhost",
            port: options.port || (options.secure ? 465 : 587),
            localAddress: options.localAddress
          });
        } catch {
          callback(new RecordedMailError("retryable"), false);
          return;
        }
        const connection = socket;
        let returned = false;
        const failed = () => {
          if (returned) return;
          returned = true;
          clearTimeout(connectionTimer);
          if (!settled) callback(new RecordedMailError("retryable"), false);
        };
        connection.once("error", failed);
        connectionTimer = setTimeout(() => {
          connection.destroy();
          failed();
        }, 10000);
        connection.once("connect", () => {
          if (returned) return;
          returned = true;
          clearTimeout(connectionTimer);
          connection.removeListener("error", failed);
          if (settled) {
            connection.destroy();
            return;
          }
          callback(null, { connection });
        });
      }
    });
    const finish = (error?: unknown, result?: SMTPTransport.SentMessageInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(connectionTimer);
      signal?.removeEventListener("abort", abort);
      socket?.destroy();
      transport.close();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new RecordedMailError("uncertain"));
    };
    abort = () => finish(new RecordedMailError("uncertain"));
    signal?.addEventListener("abort", abort, { once: true });
    deadline = setTimeout(abort, 30000);
    try {
      transport.sendMail(message).then((result) => finish(undefined, result), finish);
    } catch (error) {
      finish(error);
    }
  });
};
