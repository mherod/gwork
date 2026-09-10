import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ArgumentError } from "../../../src/services/errors.ts";
import type { SlidesService, PresentationMeta } from "../../../src/services/slides-service.ts";

void mock.module("ora", () => ({ default: () => ({ start: () => ({ stop() {}, text: "" }) }) }));
const errors: unknown[] = [];
void mock.module("../../../src/utils/command-error-handler.ts", () => ({
  logServiceError: (error: unknown) => { errors.push(error); },
}));
import { handleSlidesCommand } from "../../../src/commands/slides.ts";

const metadata: PresentationMeta = {
  presentationId: "deck", title: "Quarterly update", locale: "en_GB", pageSize: { width: 720, height: 405, unit: "PT" },
  slideCount: 2, masterCount: 1, layoutCount: 3,
  slides: [
    { objectId: "first", pageType: "SLIDE", title: "Overview", speakerNotes: "Discuss progress\nand next steps" },
    { objectId: "second", pageType: "SLIDE", title: "Results", speakerNotes: "" },
  ],
};

describe("handleSlidesCommand", () => {
  let log: ReturnType<typeof spyOn>;
  let exit: ReturnType<typeof spyOn>;
  const getPresentation = mock(async () => metadata);
  const readContent = mock(async () => ({ title: metadata.title, slides: metadata.slides }));
  const createPresentation = mock(async () => metadata);
  const getSlideThumbnail = mock(async () => "https://example.com/thumbnail");
  const initialize = mock(async () => {});
  const factory = mock((_account: string) => ({ initialize, getPresentation, readContent, createPresentation, getSlideThumbnail }) as unknown as SlidesService);
  const output = () => log.mock.calls.map((call: unknown[]) => call[0]).join("\n");

  beforeEach(() => {
    errors.length = 0;
    initialize.mockClear();
    factory.mockClear();
    getPresentation.mockReset().mockResolvedValue(metadata);
    readContent.mockReset().mockResolvedValue({ title: metadata.title, slides: metadata.slides });
    createPresentation.mockReset().mockResolvedValue(metadata);
    getSlideThumbnail.mockReset().mockResolvedValue("https://example.com/thumbnail");
    log = spyOn(console, "log").mockImplementation(() => {});
    exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    log.mockRestore();
    exit.mockRestore();
  });

  it("gets presentation metadata with the requested account", async () => {
    await handleSlidesCommand("get", ["deck"], "work@example.com", factory);
    expect(factory).toHaveBeenCalledWith("work@example.com");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(getPresentation).toHaveBeenCalledWith("deck");
    for (const text of ["Quarterly update", "en_GB", "Slides:   2", "Masters:  1", "Layouts:  3", "https://docs.google.com/presentation/d/deck/edit"]) expect(output()).toContain(text);
    expect(exit).not.toHaveBeenCalled();
  });

  it("lists numbered slides and keeps notes on one line", async () => {
    await handleSlidesCommand("list", ["deck"], "default", factory);
    expect(getPresentation).toHaveBeenCalledWith("deck");
    expect(output()).toContain("1. Overview — Discuss progress and next steps");
    expect(output()).toContain("2. Results");
    expect(output()).toContain("2 slide(s)");
  });

  it("truncates long notes in the slide list", async () => {
    getPresentation.mockResolvedValue({ ...metadata, slides: [{ ...metadata.slides[0]!, speakerNotes: "x".repeat(80) }] });
    await handleSlidesCommand("list", ["deck"], "default", factory);
    expect(output()).toContain(`${"x".repeat(59)}…`);
    expect(output()).not.toContain("x".repeat(60));
  });

  it("reads slide titles and notes as text", async () => {
    await handleSlidesCommand("read", ["deck"], "default", factory);
    expect(readContent).toHaveBeenCalledWith("deck");
    expect(output()).toContain("Slide 1: Overview");
    expect(output()).toContain("Slide 2: Results");
    expect(output()).toContain("Notes: Discuss progress");
  });

  it("shows only slides that contain notes with --notes", async () => {
    await handleSlidesCommand("read", ["deck", "--notes"], "default", factory);
    expect(output()).toContain("Slide 1: Overview");
    expect(output()).toContain("Discuss progress");
    expect(output()).not.toContain("Results");
  });

  it("emits complete structured content with --format json", async () => {
    await handleSlidesCommand("read", ["deck", "--format", "json"], "default", factory);
    expect(JSON.parse(output())).toEqual({ title: metadata.title, slides: metadata.slides });
  });

  it("creates a presentation and prints its ID and link", async () => {
    await handleSlidesCommand("create", ["Quarterly update"], "default", factory);
    expect(createPresentation).toHaveBeenCalledWith("Quarterly update");
    expect(output()).toContain("Created: Quarterly update");
    expect(output()).toContain("https://docs.google.com/presentation/d/deck/edit");
  });

  it("resolves one-based slide numbers to object IDs for thumbnails", async () => {
    await handleSlidesCommand("thumbnail", ["deck", "2"], "default", factory);
    expect(getPresentation).toHaveBeenCalledWith("deck");
    expect(getSlideThumbnail).toHaveBeenCalledWith("deck", "second");
    expect(output()).toContain("Slide 2: Results");
    expect(output()).toContain("https://example.com/thumbnail");
  });

  for (const number of ["1.5", "1junk", "1e2", "0x1", "+1", " 1", "1 ", "1\n", "", "9007199254740992"]) {
    it(`rejects malformed thumbnail slide number ${JSON.stringify(number)} before fetching data`, async () => {
      await handleSlidesCommand("thumbnail", ["deck", number], "default", factory);
      expect(errors[0]).toBeInstanceOf(ArgumentError);
      expect((errors[0] as Error).message).toContain("slide number must be a positive integer");
      expect(getPresentation).not.toHaveBeenCalled();
      expect(getSlideThumbnail).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  }

  for (const [number, objectId] of [["1", "first"], ["02", "second"]] as const) {
    it(`preserves valid one-based thumbnail slide ${number}`, async () => {
      await handleSlidesCommand("thumbnail", ["deck", number], "default", factory);
      expect(getSlideThumbnail).toHaveBeenCalledWith("deck", objectId);
      expect(errors).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
    });
  }

  for (const number of ["0", "-1", "invalid", "3"]) {
    it(`rejects unavailable thumbnail slide ${number}`, async () => {
      await handleSlidesCommand("thumbnail", ["deck", number], "default", factory);
      expect(errors[0]).toBeInstanceOf(ArgumentError);
      expect(getSlideThumbnail).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  }

  it("rejects thumbnail when only a presentation ID is supplied", async () => {
    await handleSlidesCommand("thumbnail", ["deck"], "default", factory);
    expect(errors[0]).toBeInstanceOf(ArgumentError);
    expect(getPresentation).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  for (const [command, args, endpoint] of [
    ["get", ["deck"], getPresentation], ["list", ["deck"], getPresentation],
    ["read", ["deck"], readContent], ["create", ["New presentation"], createPresentation],
    ["thumbnail", ["deck", "1"], getSlideThumbnail],
  ] as const) {
    it(`rejects ${command} without its required arguments`, async () => {
      await handleSlidesCommand(command, [], "default", factory);
      expect(errors[0]).toBeInstanceOf(ArgumentError);
      expect(exit).toHaveBeenCalledWith(1);
      expect(endpoint).not.toHaveBeenCalled();
    });

    it(`reports ${command} service failures and exits`, async () => {
      const error = new Error("Presentation unavailable");
      endpoint.mockRejectedValue(error);
      await handleSlidesCommand(command, [...args], "default", factory);
      expect(errors).toEqual([error]);
      expect(exit).toHaveBeenCalledWith(1);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  }
});
