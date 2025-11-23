#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import prompts from "prompts";
import ora from "ora";
import chalk from "chalk";
import * as dotenv from "dotenv";
import {
  generateAiImage,
  generateElevenLabsVoice,
  generateLocalVoice,
  getGenerateImageDescriptionPrompt,
  getGenerateStoryPrompt,
  getLocalTtsConfigFromEnv,
  openaiStructuredCompletion,
  setApiKey,
  buildAlignmentFromText,
} from "./service";
import {
  ContentItemWithDetails,
  StoryMetadataWithDetails,
  StoryScript,
  StoryWithImages,
} from "../src/lib/types";
import { v4 as uuidv4 } from "uuid";
import { createTimeLineFromStoryWithDetails } from "./timeline";
import { ContentFS } from "./content-fs";

dotenv.config({ quiet: true });

interface GenerateOptions {
  apiKey?: string;
  elevenlabsApiKey?: string;
  title?: string;
  topic?: string;
}

async function generateStory(options: GenerateOptions) {
  try {
    let apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    const localTtsConfig = getLocalTtsConfigFromEnv();
    let elevenlabsApiKey =
      options.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
    const disableImages =
      process.env.DISABLE_IMAGE_GENERATION === "1" ||
      process.env.DISABLE_IMAGE_GENERATION === "true";
    const syntheticTimestampsOnly =
      process.env.SYNTHETIC_TIMESTAMPS_ONLY === "1" ||
      process.env.SYNTHETIC_TIMESTAMPS_ONLY === "true";

    if (!apiKey) {
      const response = await prompts({
        type: "password",
        name: "apiKey",
        message: "Enter your OpenAI API key:",
        validate: (value) => value.length > 0 || "API key is required",
      });

      if (!response.apiKey) {
        console.log(chalk.red("API key is required. Exiting..."));
        process.exit(1);
      }

      apiKey = response.apiKey;
    }

    if (!syntheticTimestampsOnly && !localTtsConfig && !elevenlabsApiKey) {
      const response = await prompts({
        type: "password",
        name: "elevenlabsApiKey",
        message: "Enter your ElevenLabs API key:",
        validate: (value) =>
          value.length > 0 || "ElevenLabs API key is required",
      });

      if (!response.elevenlabsApiKey) {
        console.log(chalk.red("API key is required. Exiting..."));
        process.exit(1);
      }

      elevenlabsApiKey = response.elevenlabsApiKey;
    }

    let { title, topic } = options;

    if (!title || !topic) {
      const response = await prompts([
        {
          type: "text",
          name: "title",
          message: "Title of the story:",
          initial: title,
          validate: (value) => value.length > 0 || "Title is required",
        },
        {
          type: "text",
          name: "topic",
          message: "Topic of the story:",
          initial: topic,
          validate: (value) => value.length > 0 || "Topic is required",
        },
      ]);

      if (!response.title || !response.topic) {
        console.log(chalk.red("Title and topic are required. Exiting..."));
        process.exit(1);
      }

      title = response.title;
      topic = response.topic;
    }

    console.log(chalk.blue(`\n📖 Creating story: "${title}"`));
    console.log(chalk.blue(`📝 Topic: ${topic}\n`));

    const storyWithDetails: StoryMetadataWithDetails = {
      shortTitle: title!,
      content: [],
    };

    const storySpinner = ora("Generating story...").start();
    setApiKey(apiKey!);
    const storyRes = await openaiStructuredCompletion(
      getGenerateStoryPrompt(title!, topic!),
      StoryScript,
    );
    storySpinner.succeed(chalk.green("Story generated!"));

    const descriptionsSpinner = ora("Generating image descriptions...").start();
    const storyWithImagesRes = await openaiStructuredCompletion(
      getGenerateImageDescriptionPrompt(storyRes.text, title!, topic!),
      StoryWithImages,
    );
    descriptionsSpinner.succeed(chalk.green("Image descriptions generated!"));

    for (const item of storyWithImagesRes.result) {
      const contentWithDetails: ContentItemWithDetails = {
        text: item.text,
        imageDescription: item.imageDescription,
        uid: uuidv4(),
        audioTimestamps: {
          characters: [],
          characterStartTimesSeconds: [],
          characterEndTimesSeconds: [],
        },
      };

      storyWithDetails.content.push(contentWithDetails);
    }

    const contentFs = new ContentFS(title!);
    contentFs.saveDescriptor(storyWithDetails);

    const imagesSpinner = ora(
      disableImages ? "Generating voice..." : "Generating images and voice...",
    ).start();
    const usingLocalTts = Boolean(localTtsConfig) && !syntheticTimestampsOnly;
    for (let i = 0; i < storyWithDetails.content.length; i++) {
      const storyItem = storyWithDetails.content[i];

      if (!disableImages) {
        imagesSpinner.text = `[${i * 2 + 1}/${storyWithDetails.content.length * 2}] Generating image for ${storyItem.text}`;
        await generateAiImage({
          prompt: storyItem.imageDescription,
          path: contentFs.getImagePath(storyItem.uid),
          onRetry: (attempt) => {
            imagesSpinner.text = `[${i * 2 + 1}/${storyWithDetails.content.length * 2}] Generating image for ${storyItem.text} (retry ${attempt + 1})`;
          },
        });
        imagesSpinner.text = `[${i * 2 + 2}/${storyWithDetails.content.length * 2}] Generating voice for ${storyItem.text} (${usingLocalTts ? "local" : "ElevenLabs"})`;
      } else {
        imagesSpinner.text = `[${i + 1}/${storyWithDetails.content.length}] Generating voice for ${storyItem.text} (${usingLocalTts ? "local" : "ElevenLabs"})`;
      }
      const audioPath = contentFs.getAudioPath(storyItem.uid);
      const timings = syntheticTimestampsOnly
        ? buildAlignmentFromText(storyItem.text, 0)
        : usingLocalTts
          ? await generateLocalVoice(
              storyItem.text,
              localTtsConfig!,
              audioPath,
            )
          : await generateElevenLabsVoice(
              storyItem.text,
              elevenlabsApiKey!,
              audioPath,
            );
      storyItem.audioTimestamps = timings;
    }
    contentFs.saveDescriptor(storyWithDetails);
    imagesSpinner.succeed(
      chalk.green(disableImages ? "Voice generated!" : "Images generated!"),
    );

    const finalSpinner = ora("Generating final result...").start();
    const timeline = createTimeLineFromStoryWithDetails(storyWithDetails);
    contentFs.saveTimeline(timeline);
    finalSpinner.succeed(chalk.green("Final result generated!"));

    console.log(chalk.green.bold("\n✨ Story generation complete!\n"));
    console.log("Run " + chalk.blue("npm run dev") + " to preview the story");

    return {};
  } catch (error) {
    console.error(chalk.red("\n❌ Error:"), error);
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .command(
    "generate",
    "Generate story timeline for given title and topic",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Title of the story",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description:
            "Topic of the story (e.g. Interesting Facts, History, etc.)",
        });
    },
    async (argv) => {
      await generateStory({
        apiKey: argv["api-key"],
        title: argv.title,
        topic: argv.topic,
      });
    },
  )
  .command(
    "$0",
    "Generate a story (default command)",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Title of the story",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description:
            "Topic of the story (e.g. Interesting Facts, History, etc.)",
        });
    },
    async (argv) => {
      await generateStory({
        apiKey: argv["api-key"],
        title: argv.title,
        topic: argv.topic,
      });
    },
  )
  .demandCommand(0, 1)
  .help()
  .alias("help", "h")
  .version()
  .alias("version", "v")
  .strict()
  .parse();
