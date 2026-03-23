import chalk from "chalk";
import ora from "ora";
import { SlidesService } from "../services/slides-service.ts";
import { ArgumentError } from "../services/errors.ts";
import { handleCommandWithRetry } from "../utils/command-handler.ts";
import { CommandRegistry } from "./registry.ts";

async function getPresentation(svc: SlidesService, presentationId: string): Promise<void> {
  const spinner = ora("Fetching presentation metadata…").start();
  const meta = await svc.getPresentation(presentationId);
  spinner.stop();

  console.log(`Title:    ${chalk.bold(meta.title)}`);
  console.log(`ID:       ${meta.presentationId}`);
  console.log(`Locale:   ${meta.locale}`);
  console.log(`Slides:   ${meta.slideCount}`);
  console.log(`Masters:  ${meta.masterCount}`);
  console.log(`Layouts:  ${meta.layoutCount}`);
  console.log(`Link:     https://docs.google.com/presentation/d/${meta.presentationId}/edit`);
}

async function listSlides(svc: SlidesService, presentationId: string): Promise<void> {
  const spinner = ora("Fetching slides…").start();
  const meta = await svc.getPresentation(presentationId);
  spinner.stop();

  console.log(`${chalk.bold(meta.title)}`);
  console.log(chalk.gray(`https://docs.google.com/presentation/d/${meta.presentationId}/edit\n`));

  for (let i = 0; i < meta.slides.length; i++) {
    const slide = meta.slides[i]!;
    const notes = slide.speakerNotes ? chalk.gray(` — ${truncate(slide.speakerNotes, 60)}`) : "";
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${slide.title}${notes}`);
  }

  console.log(chalk.gray(`\n${meta.slideCount} slide(s)`));
}

async function readSlides(svc: SlidesService, presentationId: string, args: string[]): Promise<void> {
  const format = extractFlag(args, "--format") || "text";
  const notesOnly = args.includes("--notes");

  const spinner = ora("Reading presentation…").start();
  const content = await svc.readContent(presentationId);
  spinner.stop();

  if (format === "json") {
    console.log(JSON.stringify(content, null, 2));
    return;
  }

  console.log(chalk.bold(content.title));
  console.log(chalk.gray(`${content.slides.length} slides\n`));

  for (let i = 0; i < content.slides.length; i++) {
    const slide = content.slides[i]!;

    if (notesOnly) {
      if (slide.speakerNotes) {
        console.log(`${chalk.cyan(`Slide ${i + 1}:`)} ${slide.title}`);
        console.log(`  ${slide.speakerNotes}\n`);
      }
    } else {
      console.log(chalk.cyan(`── Slide ${i + 1}: ${slide.title} ──`));
      if (slide.speakerNotes) {
        console.log(chalk.gray(`  Notes: ${slide.speakerNotes}`));
      }
      console.log();
    }
  }
}

async function thumbnailSlide(svc: SlidesService, presentationId: string, args: string[]): Promise<void> {
  const slideIndex = parseInt(args[0] || "1", 10);
  if (isNaN(slideIndex) || slideIndex < 1) {
    throw new ArgumentError("Error: slide number must be a positive integer", "gwork slides thumbnail <fileId> <slideNumber>");
  }

  const spinner = ora("Fetching presentation…").start();
  const meta = await svc.getPresentation(presentationId);

  if (slideIndex > meta.slides.length) {
    spinner.stop();
    throw new ArgumentError(
      `Error: slide ${slideIndex} does not exist (presentation has ${meta.slides.length} slides)`,
      `gwork slides thumbnail <fileId> <1-${meta.slides.length}>`
    );
  }

  const slide = meta.slides[slideIndex - 1]!;
  spinner.text = `Fetching thumbnail for slide ${slideIndex}…`;
  const url = await svc.getSlideThumbnail(presentationId, slide.objectId);
  spinner.stop();

  console.log(`Slide ${slideIndex}: ${chalk.bold(slide.title)}`);
  console.log(`Thumbnail: ${chalk.underline(url)}`);
}

async function createPresentation(svc: SlidesService, title: string): Promise<void> {
  const spinner = ora(`Creating presentation "${title}"…`).start();
  const meta = await svc.createPresentation(title);
  spinner.stop();

  console.log(`Created: ${chalk.bold(meta.title)}`);
  console.log(`ID:      ${meta.presentationId}`);
  console.log(`Slides:  ${meta.slideCount}`);
  console.log(`Link:    https://docs.google.com/presentation/d/${meta.presentationId}/edit`);
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, " ");
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function buildSlidesRegistry(): CommandRegistry<SlidesService> {
  return new CommandRegistry<SlidesService>()
    .register("get", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: presentation ID is required", "gwork slides get <fileId>");
      }
      return getPresentation(svc, args[0]!);
    })
    .register("list", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError("Error: presentation ID is required", "gwork slides list <fileId>");
      }
      return listSlides(svc, args[0]!);
    })
    .register("read", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: presentation ID is required",
          "gwork slides read <fileId> [--notes] [--format text|json]"
        );
      }
      return readSlides(svc, args[0]!, args.slice(1));
    })
    .register("create", (svc, args) => {
      if (args.length === 0) {
        throw new ArgumentError(
          "Error: presentation title is required",
          'gwork slides create "My Presentation"'
        );
      }
      return createPresentation(svc, args[0]!);
    })
    .register("thumbnail", (svc, args) => {
      if (args.length < 2) {
        throw new ArgumentError(
          "Error: presentation ID and slide number are required",
          "gwork slides thumbnail <fileId> <slideNumber>"
        );
      }
      return thumbnailSlide(svc, args[0]!, args.slice(1));
    });
}

export async function handleSlidesCommand(
  subcommand: string,
  args: string[],
  account = "default",
  serviceFactory: (account: string) => SlidesService = (acc) => new SlidesService(acc)
) {
  await handleCommandWithRetry({
    tokenKey: "slides",
    serviceName: "Slides",
    account,
    subcommand,
    serviceFactory,
    execute: (svc) => buildSlidesRegistry().execute(subcommand, svc, args),
  });
}
