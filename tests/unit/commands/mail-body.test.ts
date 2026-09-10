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
});
