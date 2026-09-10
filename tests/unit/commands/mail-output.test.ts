import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import fs from "node:fs";
import { handleMailCommand } from "../../../src/commands/mail.ts";
import type { MailService } from "../../../src/services/mail-service.ts";
import type { Message } from "../../../src/types/google-apis.ts";
import { logger } from "../../../src/utils/logger.ts";

void mock.module("ora", () => ({ default: () => ({ start: () => ({ succeed() {}, fail() {}, stop() {} }) }) }));

describe("structured mail output", () => {
  let output: string[];
  let log: ReturnType<typeof spyOn>;
  let error: ReturnType<typeof spyOn>;
  const data = Buffer.from("Attachment bytes").toString("base64url");
  const message: Message = {
    id: "message", threadId: "thread",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "Subject", value: "Fixture" }, { name: "Received", value: "one" }, { name: "Received", value: "two" }],
      parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Hello ✓").toString("base64url") } },
        { mimeType: "multipart/mixed", parts: [
          { filename: "one.pdf", mimeType: "application/pdf", body: { attachmentId: "opaque-_one", size: 12, data } },
          { filename: "two.pdf", mimeType: "application/pdf", body: { attachmentId: "opaque-_two", size: 34 } },
        ] }],
    },
  };
  function service(msg: Message = message) {
    return () => ({
      initialize: async () => logger.info("Initialization diagnostic"),
      getMessage: async () => msg,
      getAttachment: async () => ({ data }),
    }) as unknown as MailService;
  }
  beforeEach(() => {
    output = [];
    log = spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
    error = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { log.mockRestore(); error.mockRestore(); });

  it("emits only JSON on stdout and preserves opaque IDs for multiple nested attachments", async () => {
    await handleMailCommand("attachments", ["message", "--json"], "default", service());
    expect(JSON.parse(output.join("\n"))).toEqual([
      { filename: "one.pdf", mimeType: "application/pdf", sizeBytes: 12, attachmentId: "opaque-_one" },
      { filename: "two.pdf", mimeType: "application/pdf", sizeBytes: 34, attachmentId: "opaque-_two" },
    ]);
    expect(error).toHaveBeenCalledWith("Initialization diagnostic");
    expect(logger.getConfig().outputToStderr).toBe(false);
  });

  it("round-trips each returned ID into download without altering it", async () => {
    await handleMailCommand("attachments", ["message", "--json"], "default", service());
    const attachments = JSON.parse(output.join("\n")) as { attachmentId: string; filename: string }[];
    const write = spyOn(fs, "writeFileSync").mockImplementation(() => {});
    try {
      for (const attachment of attachments) {
        await handleMailCommand("download", ["message", attachment.attachmentId], "default", service());
        expect(write).toHaveBeenCalledWith(attachment.filename, Buffer.from("Attachment bytes"));
      }
    } finally { write.mockRestore(); }
  });

  it("preserves duplicate headers and the body part tree with decoded text", async () => {
    await handleMailCommand("get", ["message", "--json"], "default", service());
    const result = JSON.parse(output.join("\n"));
    expect(result.headers).toEqual(message.payload!.headers);
    expect(result.bodyParts[0].parts[0].text).toBe("Hello ✓");
    expect(result.bodyParts[0].parts[1].parts[0].attachmentId).toBe("opaque-_one");
    expect(result.bodyParts[0].parts[1].parts[0].data).toBe(data);
  });

  it("emits an empty array when no attachments exist", async () => {
    await handleMailCommand("attachments", ["empty", "--json"], "default", service({}));
    expect(JSON.parse(output.join("\n"))).toEqual([]);
  });

  it("retains the human attachment layout without --json", async () => {
    await handleMailCommand("attachments", ["message"], "default", service());
    expect(output.join("\n")).toContain("Attachment ID:");
    expect(output.join("\n")).toContain("one.pdf");
  });
});
