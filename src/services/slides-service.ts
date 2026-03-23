/**
 * Google Slides service wrapper for Google Slides API v1.
 * Provides methods for reading presentation metadata and slide content.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import type { slides_v1 } from "googleapis";

export interface SlideInfo {
  objectId: string;
  pageType: string;
  title: string;
  speakerNotes: string;
}

export interface PresentationMeta {
  presentationId: string;
  title: string;
  locale: string;
  pageSize: { width: number; height: number; unit: string };
  slideCount: number;
  slides: SlideInfo[];
  masterCount: number;
  layoutCount: number;
}

export class SlidesService extends BaseService {
  private slides: slides_v1.Slides | null = null;

  constructor(account = "default") {
    super(
      "Slides",
      [
        "https://www.googleapis.com/auth/presentations",
      ],
      account
    );
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    this.slides = google.slides({ version: "v1", auth: this.getAuth() });
    await this.verifyAccount();
  }

  /**
   * Get full presentation metadata including slide list.
   */
  async getPresentation(presentationId: string): Promise<PresentationMeta> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.slides!.presentations.get({
        presentationId,
      });

      const data = result.data;
      const pageSize = data.pageSize || {};
      const width = pageSize.width?.magnitude || 0;
      const height = pageSize.height?.magnitude || 0;
      const unit = pageSize.width?.unit || "EMU";

      const allSlides = (data.slides || []).map((slide, index) =>
        this.mapSlide(slide, index)
      );

      return {
        presentationId: data.presentationId || presentationId,
        title: data.title || "",
        locale: data.locale || "",
        pageSize: { width, height, unit },
        slideCount: allSlides.length,
        slides: allSlides,
        masterCount: (data.masters || []).length,
        layoutCount: (data.layouts || []).length,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get presentation");
    }
  }

  /**
   * Read text content from all slides in the presentation.
   */
  async readContent(presentationId: string): Promise<{ title: string; slides: SlideInfo[] }> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.slides!.presentations.get({
        presentationId,
      });

      const data = result.data;
      const slides = (data.slides || []).map((slide, index) =>
        this.mapSlide(slide, index)
      );

      return {
        title: data.title || "",
        slides,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "read presentation");
    }
  }

  /**
   * Get a thumbnail URL for a specific slide.
   */
  async getSlideThumbnail(
    presentationId: string,
    pageObjectId: string
  ): Promise<string> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.slides!.presentations.pages.getThumbnail({
        presentationId,
        pageObjectId,
        "thumbnailProperties.thumbnailSize": "LARGE",
      });

      return result.data.contentUrl || "";
    } catch (error: unknown) {
      handleGoogleApiError(error, "get slide thumbnail");
    }
  }

  /**
   * Create a new presentation.
   */
  async createPresentation(title: string): Promise<PresentationMeta> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.slides!.presentations.create({
        requestBody: { title },
      });

      const data = result.data;
      const pageSize = data.pageSize || {};
      const width = pageSize.width?.magnitude || 0;
      const height = pageSize.height?.magnitude || 0;
      const unit = pageSize.width?.unit || "EMU";

      const allSlides = (data.slides || []).map((slide, index) =>
        this.mapSlide(slide, index)
      );

      return {
        presentationId: data.presentationId || "",
        title: data.title || title,
        locale: data.locale || "",
        pageSize: { width, height, unit },
        slideCount: allSlides.length,
        slides: allSlides,
        masterCount: (data.masters || []).length,
        layoutCount: (data.layouts || []).length,
      };
    } catch (error: unknown) {
      handleGoogleApiError(error, "create presentation");
    }
  }

  /**
   * Map a slide page to SlideInfo, extracting title and speaker notes.
   */
  private mapSlide(slide: slides_v1.Schema$Page, index: number): SlideInfo {
    return {
      objectId: slide.objectId || "",
      pageType: slide.pageType || "SLIDE",
      title: this.extractSlideTitle(slide, index),
      speakerNotes: this.extractSpeakerNotes(slide),
    };
  }

  /**
   * Extract the title text from a slide's page elements.
   */
  private extractSlideTitle(slide: slides_v1.Schema$Page, index: number): string {
    if (slide.pageElements) {
      for (const element of slide.pageElements) {
        const shape = element.shape;
        if (shape?.placeholder?.type === "TITLE" || shape?.placeholder?.type === "CENTERED_TITLE") {
          const text = this.extractShapeText(shape);
          if (text.trim()) return text.trim();
        }
      }
    }
    return `Slide ${index + 1}`;
  }

  /**
   * Extract speaker notes from a slide.
   */
  private extractSpeakerNotes(slide: slides_v1.Schema$Page): string {
    const notes = slide.slideProperties?.notesPage;
    if (!notes?.pageElements) return "";

    for (const element of notes.pageElements) {
      const shape = element.shape;
      if (shape?.placeholder?.type === "BODY") {
        const text = this.extractShapeText(shape);
        if (text.trim()) return text.trim();
      }
    }
    return "";
  }

  /**
   * Extract plain text from a shape's text content.
   */
  private extractShapeText(shape: slides_v1.Schema$Shape): string {
    const parts: string[] = [];
    if (shape.text?.textElements) {
      for (const te of shape.text.textElements) {
        if (te.textRun?.content) {
          parts.push(te.textRun.content);
        }
      }
    }
    return parts.join("");
  }
}
