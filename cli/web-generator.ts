import * as dotenv from "dotenv";
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

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  if (!localTtsConfig && !elevenlabsApiKey) {
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
    getGenerateImageDescriptionPrompt(storyRes.text),
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

  const usingLocalTts = Boolean(localTtsConfig);

  for (let i = 0; i < storyWithDetails.content.length; i++) {
    const storyItem = storyWithDetails.content[i];

    await generateAiImage({
      prompt: storyItem.imageDescription,
      path: contentFs.getImagePath(storyItem.uid),
      onRetry: () => {},
    });

    const audioPath = contentFs.getAudioPath(storyItem.uid);
    const timings = usingLocalTts
      ? await generateLocalVoice(storyItem.text, localTtsConfig!, audioPath)
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
