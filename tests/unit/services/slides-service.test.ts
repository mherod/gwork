import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { google, type slides_v1 } from "googleapis";
import { SlidesService } from "../../../src/services/slides-service.ts";
import { PermissionDeniedError } from "../../../src/services/errors.ts";
import { mockWorkspaceAuth } from "../helpers/workspace-service.ts";

const presentation: slides_v1.Schema$Presentation = {
  presentationId: "deck", title: "Quarterly update", locale: "en_GB",
  pageSize: { width: { magnitude: 720, unit: "PT" }, height: { magnitude: 405, unit: "PT" } },
  masters: [{}], layouts: [{}, {}],
  slides: [
    { objectId: "first", pageType: "SLIDE", pageElements: [
      { shape: { placeholder: { type: "BODY" }, text: { textElements: [{ textRun: { content: "Not the title" } }] } } },
      { shape: { placeholder: { type: "TITLE" }, text: { textElements: [{ textRun: { content: " Progress" } }, { textRun: { content: " report\n" } }] } } },
    ], slideProperties: { notesPage: { pageElements: [
      { shape: { placeholder: { type: "SLIDE_NUMBER" }, text: { textElements: [{ textRun: { content: "1" } }] } } },
      { shape: { placeholder: { type: "BODY" }, text: { textElements: [{ textRun: { content: "First " } }, { textRun: { content: "note\n" } }, {}] } } },
    ] } } },
    { objectId: "second", pageElements: [{ shape: { placeholder: { type: "CENTERED_TITLE" }, text: { textElements: [{ textRun: { content: " Overview " } }] } } }] },
    { pageElements: [{ shape: { placeholder: { type: "TITLE" }, text: { textElements: [{ textRun: { content: " \n" } }] } } }] },
  ],
};
const mappedSlides = [
  { objectId: "first", pageType: "SLIDE", title: "Progress report", speakerNotes: "First note" },
  { objectId: "second", pageType: "SLIDE", title: "Overview", speakerNotes: "" },
  { objectId: "", pageType: "SLIDE", title: "Slide 3", speakerNotes: "" },
];

describe("SlidesService", () => {
  let auth: ReturnType<typeof mockWorkspaceAuth>;
  let service: SlidesService;
  let clientSpy: ReturnType<typeof spyOn<typeof google, "slides">>;
  const get = mock(async () => ({ data: {} as slides_v1.Schema$Presentation }));
  const create = mock(async () => ({ data: {} as slides_v1.Schema$Presentation }));
  const getThumbnail = mock(async () => ({ data: {} as slides_v1.Schema$Thumbnail }));

  beforeEach(() => {
    auth = mockWorkspaceAuth();
    get.mockReset().mockResolvedValue({ data: {} });
    create.mockReset().mockResolvedValue({ data: {} });
    getThumbnail.mockReset().mockResolvedValue({ data: {} });
    clientSpy = spyOn(google, "slides").mockReturnValue({
      presentations: { get, create, pages: { getThumbnail } },
    } as unknown as slides_v1.Slides);
    service = new SlidesService();
  });

  afterEach(() => {
    clientSpy.mockRestore();
    auth.restore();
  });

  it("initializes the Slides client with write scope and skips default-account verification", async () => {
    await service.initialize();
    await service.initialize();
    expect(auth.authenticate).toHaveBeenCalledTimes(1);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({
      service: "Slides", account: "default", forceReauth: false,
      requiredScopes: ["https://www.googleapis.com/auth/presentations"],
    }));
    expect(clientSpy).toHaveBeenCalledWith({ version: "v1", auth: auth.auth });
    expect(auth.oauth).not.toHaveBeenCalled();
  });

  it("accepts named accounts case-insensitively and forwards forced authentication", async () => {
    service = new SlidesService("WORK@example.com");
    await service.initialize(true);
    expect(auth.authenticate).toHaveBeenCalledWith(expect.objectContaining({ forceReauth: true }));
    expect(auth.userinfo).toHaveBeenCalledTimes(1);
  });

  it("blocks operations for an account mismatch", async () => {
    service = new SlidesService("other@example.com");
    const mismatch = await service.getPresentation("deck").catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as Error).message).toContain('Run "gwork slides --account other@example.com" to re-authenticate the correct account.');
    expect(get).not.toHaveBeenCalled();
  });

  it("maps dimensions, counts, title placeholders and speaker notes", async () => {
    get.mockResolvedValue({ data: presentation });
    expect(await service.getPresentation("deck")).toEqual({
      presentationId: "deck", title: "Quarterly update", locale: "en_GB", pageSize: { width: 720, height: 405, unit: "PT" },
      slideCount: 3, slides: mappedSlides, masterCount: 1, layoutCount: 2,
    });
    expect(get).toHaveBeenCalledWith({ presentationId: "deck" });
  });

  it("supplies defaults for absent metadata", async () => {
    expect(await service.getPresentation("deck")).toEqual({
      presentationId: "deck", title: "", locale: "", pageSize: { width: 0, height: 0, unit: "EMU" },
      slideCount: 0, slides: [], masterCount: 0, layoutCount: 0,
    });
  });

  it("reads mapped slide titles and speaker notes", async () => {
    get.mockResolvedValue({ data: presentation });
    expect(await service.readContent("deck")).toEqual({ title: "Quarterly update", slides: mappedSlides });
    expect(get).toHaveBeenCalledWith({ presentationId: "deck" });
  });

  it("returns empty content when no slides exist", async () => {
    expect(await service.readContent("deck")).toEqual({ title: "", slides: [] });
  });

  it("requests a large thumbnail by slide object ID", async () => {
    getThumbnail.mockResolvedValue({ data: { contentUrl: "https://example.com/thumbnail" } });
    expect(await service.getSlideThumbnail("deck", "second")).toBe("https://example.com/thumbnail");
    expect(getThumbnail).toHaveBeenCalledWith({ presentationId: "deck", pageObjectId: "second", "thumbnailProperties.thumbnailSize": "LARGE" });
  });

  it("returns an empty URL if thumbnail contentUrl is absent", async () => {
    expect(await service.getSlideThumbnail("deck", "second")).toBe("");
  });

  it("creates a presentation with the requested title and maps returned metadata", async () => {
    create.mockResolvedValue({ data: presentation });
    expect(await service.createPresentation("Requested title")).toEqual({
      presentationId: "deck", title: "Quarterly update", locale: "en_GB", pageSize: { width: 720, height: 405, unit: "PT" },
      slideCount: 3, slides: mappedSlides, masterCount: 1, layoutCount: 2,
    });
    expect(create).toHaveBeenCalledWith({ requestBody: { title: "Requested title" } });
  });

  it("preserves the requested title when create returns sparse data", async () => {
    expect(await service.createPresentation("New deck")).toEqual({
      presentationId: "", title: "New deck", locale: "", pageSize: { width: 0, height: 0, unit: "EMU" },
      slideCount: 0, slides: [], masterCount: 0, layoutCount: 0,
    });
  });

  for (const [operation, context, endpoint] of [
    [() => service.getPresentation("deck"), "get presentation", get],
    [() => service.readContent("deck"), "read presentation", get],
    [() => service.getSlideThumbnail("deck", "first"), "get slide thumbnail", getThumbnail],
    [() => service.createPresentation("New deck"), "create presentation", create],
  ] as const) {
    it(`routes ${context} failures through handleGoogleApiError`, async () => {
      const error = { code: 403, message: "Access denied" };
      endpoint.mockRejectedValue(error);
      const failure = await operation().catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(PermissionDeniedError);
      expect(auth.apiError).toHaveBeenCalledWith(error, context);
    });
  }
});
