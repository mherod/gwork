import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { handleMailCommand } from "../../../src/commands/mail.ts";
import type { MailService } from "../../../src/services/mail-service.ts";
import type { Message } from "../../../src/types/google-apis.ts";

void mock.module("ora", () => ({ default: () => ({ start: () => ({ succeed() {}, fail() {}, stop() {} }) }) }));

type Part = NonNullable<Message["payload"]>;
const part = (mimeType: string, text: string): Part => ({ mimeType, body: { data: Buffer.from(text).toString("base64url") } });

describe("mail body rendering", () => {
  let output: string[];
  let log: ReturnType<typeof spyOn>;
  beforeEach(() => {
    output = [];
    log = spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
  });
  afterEach(() => log.mockRestore());
  async function render(payload: Part, args: string[] = []) {
    await handleMailCommand("get", ["message", ...args], "default", () => ({
      initialize: async () => {}, getMessage: async () => ({ payload }),
    }) as unknown as MailService);
    return output.join("\n").split("Date: \n\n")[1]!;
  }

  const html = '<!DOCTYPE html><html><head><style>.secret { color: red }</style></head><body><p>Hello &amp; welcome &#x2713;.</p><SCRIPT>secretScript()</SCRIPT><style>hidden-css</style><p>Read <a href="https://example.com/?a=1&amp;b=2">the details</a>.</p></body></html>';

  it("renders HTML-only prose, entities and link targets while removing script/style subtrees", async () => {
    const result = await render(part("text/html", html));
    expect(result).toContain("Hello & welcome ✓.");
    expect(result).toContain("the details (https://example.com/?a=1&b=2)");
    expect(result).not.toMatch(/secret|hidden-css|<html|DOCTYPE/);
  });
  for (const args of [["--raw"], ["--format", "html"]]) {
    it(`preserves original HTML with ${args.join(" ")}`, async () => {
      expect(await render(part("text/html", html), args)).toBe(html);
    });
  }
  it("preserves plain-only text exactly, including spacing and literal markup", async () => {
    const text = "Hello  world\n\nLiteral <script>example</script> &amp;";
    expect(await render(part("text/plain", text))).toBe(text);
  });
  it("prefers nested plain alternatives to HTML and ignores text attachments", async () => {
    const result = await render({ mimeType: "multipart/mixed", parts: [
      { ...part("text/plain", "Attachment text"), filename: "notes.txt" },
      { mimeType: "multipart/alternative", parts: [part("text/html", html), part("text/plain", "Plain alternative")] },
    ] });
    expect(result).toStartWith("Plain alternative");
    expect(result).not.toContain("Attachment text");
  });
  it("finds an HTML-only alternative inside mixed MIME containers", async () => {
    expect(await render({ mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [part("text/html", "<p>Nested body</p>")] }] })).toBe("Nested body");
  });
  it("reports a missing explicitly selected body format", async () => {
    expect(await render(part("text/html", html), ["--format", "plain"])).toBe("[No plain version available for this message]");
  });

  const status = "Final-Recipient: rfc822; recipient@example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550\r\n No such user\r\n\r\nFinal-Recipient: rfc822; other@example.com\r\nAction: delayed\r\nStatus: 4.2.0";
  const report: Part = { mimeType: "multipart/report", parts: [
    { ...part("message/rfc822", "To: recipient@example.com\r\nSubject: Original subject\r\nDate: Thu, 1 Jan 2026 12:00:00 +0000\r\n\r\nOriginal message content"),
      parts: [part("text/plain", "Original text must not become bounce body")] },
    { mimeType: "multipart/alternative", parts: [part("text/plain", "Delivery failed: recipient not found.")] },
    part("message/delivery-status", status),
  ] };

  for (const nested of [false, true]) {
    it(`renders ${nested ? "nested" : "flat"} bounce reasons, folded status fields and original headers`, async () => {
      const payload = nested ? { mimeType: "multipart/mixed", parts: [report, { mimeType: "image/png", filename: "icon.png", body: { attachmentId: "image" } }] } : report;
      const result = await render(payload);
      expect(result).toStartWith("Delivery failed: recipient not found.");
      for (const expected of ["Action: failed", "Status: 5.1.1", "Diagnostic-Code: smtp; 550 No such user", "Final-Recipient: rfc822; recipient@example.com", "Action: delayed", "Original message:", "Subject: Original subject"]) {
        expect(result).toContain(expected);
      }
      expect(result).not.toContain("Original text must not");
    });
  }
  it("keeps text inside attached MIME containers out of body selection", async () => {
    const result = await render({ mimeType: "multipart/mixed", parts: [
      { mimeType: "multipart/mixed", headers: [{ name: "Content-Disposition", value: "attachment" }], parts: [part("text/plain", "Private attachment")] },
      part("text/html", "<p>Outer body</p>"),
    ] });
    expect(result).toBe("Outer body");
  });
  it("renders Gmail's parsed delivery-status child and headers-only original", async () => {
    const result = await render({ mimeType: "multipart/report", parts: [
      { mimeType: "message/delivery-status", parts: [{ ...part("text/plain", status), headers: [{ name: "Reporting-MTA", value: "dns; example.com" }] }] },
      part("text/plain", "Human explanation"),
      part("text/rfc822-headers", "To: recipient@example.com\r\nSubject: Headers-only original\r\nDate: Thu, 1 Jan 2026 12:00:00 +0000\r\n"),
    ] });
    expect(result).toStartWith("Human explanation");
    expect(result).toContain("Diagnostic-Code: smtp; 550 No such user");
    expect(result).toContain("Original message:\nTo: recipient@example.com\nSubject: Headers-only original");
  });
  it("lists unnamed original-message and delivery-status parts in nested attachments JSON", async () => {
    await handleMailCommand("attachments", ["message", "--json"], "default", () => ({
      initialize: async () => {}, getMessage: async () => ({ payload: { mimeType: "multipart/mixed", parts: [report] } }),
    }) as unknown as MailService);
    expect(JSON.parse(output.join("\n")).map((item: any) => item.filename)).toEqual(["original-message.eml", "delivery-status.txt"]);
  });
  it("fetches externally stored readable body data before rendering", async () => {
    const getAttachment = mock(async (_messageId: string, attachmentId: string) => ({ data: Buffer.from(attachmentId === "reason" ? "External reason" : status).toString("base64url") }));
    await handleMailCommand("get", ["message"], "default", () => ({
      initialize: async () => {}, getAttachment,
      getMessage: async () => ({ id: "message", payload: { mimeType: "multipart/report", parts: [
        { mimeType: "text/plain", body: { attachmentId: "reason" } },
        { mimeType: "message/delivery-status", body: { attachmentId: "status" } },
        { mimeType: "message/rfc822", body: { attachmentId: "original" } },
      ] } }),
    }) as unknown as MailService);
    expect(output.join("\n")).toContain("External reason");
    expect(output.join("\n")).toContain("Status: 5.1.1");
    expect(output.join("\n")).toContain("Attachment ID: original");
    expect(getAttachment.mock.calls).toEqual([["message", "reason"], ["message", "status"]]);
  });
});
