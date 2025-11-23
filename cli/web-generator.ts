import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
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
import { createTimeLineFromStoryWithDetails } from "./timeline";
import { ContentFS } from "./content-fs";

dotenv.config({ quiet: true });

export interface WebGenerateRequest {
  apiKey?: string;
  elevenlabsApiKey?: string;
  title: string;
  topic: string;
}

export interface WebGenerateResponse {
  slug: string;
  title: string;
  topic: string;
}

export interface WebStoryPreviewRequest {
  apiKey?: string;
  title: string;
  topic: string;
}

export interface WebStoryPreviewResponse {
  title: string;
  topic: string;
  text: string;
}

export interface WebRegenerateAudioRequest {
  title: string;
  elevenlabsApiKey?: string;
}

export interface WebRegenerateAudioResponse {
  slug: string;
  title: string;
  updatedCount: number;
}

export const generateStoryTextFromWeb = async (
  request: WebStoryPreviewRequest,
): Promise<WebStoryPreviewResponse> => {
  const { title, topic } = request;

  if (!title || !topic) {
    throw new Error("Title and topic are required");
  }

  let apiKey = request.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  setApiKey(apiKey);
  const storyRes = await openaiStructuredCompletion(
    getGenerateStoryPrompt(title, topic),
    StoryScript,
  );

  return {
    title,
    topic,
    text: storyRes.text,
  };
};

export const generateStoryFromWeb = async (
  request: WebGenerateRequest,
): Promise<WebGenerateResponse> => {
  const { title, topic } = request;

  if (!title || !topic) {
    throw new Error("Title and topic are required");
  }

  let apiKey = request.apiKey || process.env.OPENAI_API_KEY;
  const localTtsConfig = getLocalTtsConfigFromEnv();
  let elevenlabsApiKey =
    request.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
  const disableImages =
    process.env.DISABLE_IMAGE_GENERATION === "1" ||
    process.env.DISABLE_IMAGE_GENERATION === "true";
  const syntheticTimestampsOnly =
    process.env.SYNTHETIC_TIMESTAMPS_ONLY === "1" ||
    process.env.SYNTHETIC_TIMESTAMPS_ONLY === "true";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  if (!syntheticTimestampsOnly && !localTtsConfig && !elevenlabsApiKey) {
    throw new Error("Either LOCAL_TTS_URL or ELEVENLABS_API_KEY is required");
  }

  const storyWithDetails: StoryMetadataWithDetails = {
    shortTitle: title,
    content: [],
  };

  setApiKey(apiKey);
  const storyRes = await openaiStructuredCompletion(
    getGenerateStoryPrompt(title, topic),
    StoryScript,
  );

  const storyWithImagesRes = await openaiStructuredCompletion(
    getGenerateImageDescriptionPrompt(storyRes.text, title, topic),
    StoryWithImages,
  );

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

  const contentFs = new ContentFS(title);
  contentFs.saveDescriptor(storyWithDetails);

  const usingLocalTts = Boolean(localTtsConfig) && !syntheticTimestampsOnly;

  for (let i = 0; i < storyWithDetails.content.length; i++) {
    const storyItem = storyWithDetails.content[i];

    if (!disableImages) {
      await generateAiImage({
        prompt: storyItem.imageDescription,
        path: contentFs.getImagePath(storyItem.uid),
        onRetry: () => {},
      });
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

  const timeline = createTimeLineFromStoryWithDetails(storyWithDetails);
  contentFs.saveTimeline(timeline);

  return {
    slug: contentFs.slug,
    title,
    topic,
  };
};

export const regenerateAudioFromExistingDescriptor = async (
  request: WebRegenerateAudioRequest,
): Promise<WebRegenerateAudioResponse> => {
  const { title } = request;

  if (!title) {
    throw new Error("Title is required");
  }

  const localTtsConfig = getLocalTtsConfigFromEnv();
  let elevenlabsApiKey =
    request.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
  const syntheticTimestampsOnly =
    process.env.SYNTHETIC_TIMESTAMPS_ONLY === "1" ||
    process.env.SYNTHETIC_TIMESTAMPS_ONLY === "true";

  if (!syntheticTimestampsOnly && !localTtsConfig && !elevenlabsApiKey) {
    throw new Error("Either LOCAL_TTS_URL or ELEVENLABS_API_KEY is required");
  }

  const contentFs = new ContentFS(title);
  const slug = contentFs.slug;

  const descriptorPath = path.join(
    process.cwd(),
    "public",
    "content",
    slug,
    "descriptor.json",
  );

  if (!fs.existsSync(descriptorPath)) {
    throw new Error(`descriptor.json not found for slug ${slug}`);
  }

  const raw = fs.readFileSync(descriptorPath, "utf-8");
  const storyWithDetails: StoryMetadataWithDetails = JSON.parse(raw);

  const usingLocalTts = Boolean(localTtsConfig);
  let updatedCount = 0;

  for (const storyItem of storyWithDetails.content) {
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
    updatedCount++;
  }

  contentFs.saveDescriptor(storyWithDetails);
  const timeline = createTimeLineFromStoryWithDetails(storyWithDetails);
  contentFs.saveTimeline(timeline);

  return {
    slug,
    title: storyWithDetails.shortTitle,
    updatedCount,
  };
};
