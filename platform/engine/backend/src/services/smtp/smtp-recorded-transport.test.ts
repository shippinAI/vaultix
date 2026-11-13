import { EventEmitter } from "node:events";

import SMTPTransport from "nodemailer/lib/smtp-transport";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { sendRecordedSmtp } from "./smtp-recorded-transport";

const mocks = vi.hoisted(() => ({ transport: vi.fn(), connection: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: mocks.transport }));
vi.mock("node:net", () => ({ createConnection: mocks.connection }));
let options: SMTPTransport.Options;
let socket: EventEmitter & { destroy: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  mocks.connection.mockReturnValue(socket);
  mocks.transport.mockImplementation((config: SMTPTransport.Options) => {
    options = config;
    return { sendMail: mocks.send, close: mocks.close };
  });
  mocks.send.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        options.getSocket?.(options, (error) => {
          if (error) reject(error);
        });
      })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

test("pre-aborted caller does not instantiate a transport or socket", async () => {
  await expect(sendRecordedSmtp({}, {}, AbortSignal.abort())).rejects.toMatchObject({ disposition: "retryable" });
  expect(mocks.transport).not.toHaveBeenCalled();
  expect(mocks.connection).not.toHaveBeenCalled();
});

test("connection establishment is bounded and cannot invoke a late successful handoff", async () => {
  const result = sendRecordedSmtp({ host: "smtp.vaultix.invalid" }, {}).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(9999);
  expect(socket.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ disposition: "retryable" });
  expect(socket.destroy).toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
  socket.emit("connect");
  socket.emit("error", new Error("late-network-canary"));
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("total deadline cancels a connected send and releases the caller listener", async () => {
  const controller = new AbortController();
  const added = vi.spyOn(controller.signal, "addEventListener");
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  const result = sendRecordedSmtp({}, {}, controller.signal).catch((error: unknown) => error);
  socket.emit("connect");
  await vi.advanceTimersByTimeAsync(29999);
  expect(socket.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ disposition: "uncertain" });
  expect(socket.destroy).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
  expect(vi.getTimerCount()).toBe(0);
});

test("late socket request after cancellation cannot start another connection", async () => {
  mocks.send.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const result = sendRecordedSmtp({}, {}, controller.signal).catch((error: unknown) => error);
  controller.abort();
  expect(await result).toMatchObject({ disposition: "uncertain" });
  const callback = vi.fn();
  options.getSocket?.(options, callback);
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ disposition: "uncertain" }), false);
  expect(mocks.connection).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("socket construction failure is bounded and never exposes its raw message", async () => {
  mocks.connection.mockImplementation(() => {
    throw new Error("network-configuration-canary");
  });
  const error = await sendRecordedSmtp({}, {}).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ disposition: "retryable" });
  expect(String(error)).not.toContain("configuration-canary");
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("synchronous transport failure releases timers and resources", async () => {
  mocks.send.mockImplementation(() => {
    throw new Error("synchronous failure");
  });
  await expect(sendRecordedSmtp({}, {})).rejects.toThrow("synchronous failure");
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
