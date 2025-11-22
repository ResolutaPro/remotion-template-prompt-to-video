import z from "zod";
import * as fs from "fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { CharacterAlignmentResponseModel } from "@elevenlabs/elevenlabs-js/api";
import { parseFile } from "music-metadata";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../src/lib/constants";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GoogleGenAI } from "@google/genai";

let apiKey: string | null = null;

export const setApiKey = (key: string) => {
  apiKey = key;
};

export const openaiStructuredCompletion = async <T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsonSchema = zodToJsonSchema(schema) as any;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: {
            type: jsonSchema.type || "object",
            properties: jsonSchema.properties,
            required: jsonSchema.required,
            additionalProperties: jsonSchema.additionalProperties ?? false,
          },
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);

  const data = await res.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  const parsed = JSON.parse(content);
  return schema.parse(parsed);
};

function saveUint8ArrayToPng(uint8Array: Uint8Array, filePath: string) {
  const buffer = Buffer.from(uint8Array);
  fs.writeFileSync(filePath, buffer as Uint8Array);
}

const generateAiImageWithPexels = async ({
  prompt,
  path,
}: {
  prompt: string;
  path: string;
}) => {
  const apiKey = process.env.PEXELS_API_KEY;

  if (!apiKey) {
    throw new Error("PEXELS_API_KEY is not configured");
  }

  const searchParams = new URLSearchParams({
    query: prompt,
    per_page: "1",
    orientation: "landscape",
  });

  const res = await fetch(
    `https://api.pexels.com/v1/search?${searchParams.toString()}`,
    {
      headers: {
        Authorization: apiKey,
        Accept: "application/json, text/plain, */*",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Pexels error: ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const photos = Array.isArray(data.photos) ? data.photos : [];

  if (!photos.length) {
    throw new Error("Pexels did not return any photos");
  }

  const src = photos[0]?.src ?? {};
  const url =
    src.landscape ??
    src.large2x ??
    src.large ??
    src.original ??
    src.medium;

  if (!url || typeof url !== "string") {
    throw new Error("Pexels photo has no usable URL");
  }

  const imageRes = await fetch(url);

  if (!imageRes.ok) {
    throw new Error(`Failed to download Pexels image: ${await imageRes.text()}`);
  }

  const arrayBuffer = await imageRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const uint8Array = new Uint8Array(buffer);
  saveUint8ArrayToPng(uint8Array, path);
};

const generateAiImageWithGemini = async ({
  prompt,
  path,
}: {
  prompt: string;
  path: string;
}) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API;

  if (!apiKey) {
    throw new Error("Gemini API key is not configured (GEMINI_API or GEMINI_API_KEY)");
  }

  const client = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

  const config = {
    responseModalities: ["IMAGE"],
  } as const;

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: prompt,
        },
      ],
    },
  ];

  const stream = await client.models.generateContentStream({
    model,
    config,
    contents,
  });

  for await (const chunk of stream) {
    const inlineData =
      chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData || null;

    if (!inlineData?.data) {
      continue;
    }

    const buffer = Buffer.from(inlineData.data, "base64");
    const uint8Array = new Uint8Array(buffer);
    saveUint8ArrayToPng(uint8Array, path);
    return;
  }

  throw new Error("Gemini did not return an image");
};

const generateAiImageWithDalle = async ({
  prompt,
  path,
  onRetry,
}: {
  prompt: string;
  path: string;
  onRetry: (attempt: number) => void;
}) => {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        size: `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
        response_format: "b64_json",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const buffer = Buffer.from(data.data[0].b64_json, "base64");
      const uint8Array = new Uint8Array(buffer);

      saveUint8ArrayToPng(uint8Array, path);
      return;
    } else {
      lastError = new Error(
        `OpenAI error (attempt ${attempt + 1}): ${await res.text()}`,
      );
      attempt++;
      if (attempt < maxRetries) {
        // Wait 1 second before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      onRetry(attempt);
    }
  }

  // Ran out of retries, throw the last error
  throw lastError!;
};

export const generateAiImage = async ({
  prompt,
  path,
  onRetry,
}: {
  prompt: string;
  path: string;
  onRetry: (attempt: number) => void;
}) => {
  const provider = process.env.IMAGE_PROVIDER?.toLowerCase();
  const pexelsKey = process.env.PEXELS_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API;

  if (provider === "pexels") {
    await generateAiImageWithPexels({ prompt, path });
    return;
  }

  if (provider === "gemini") {
    await generateAiImageWithGemini({ prompt, path });
    return;
  }

  if (provider === "dalle") {
    await generateAiImageWithDalle({ prompt, path, onRetry });
    return;
  }

  if (pexelsKey) {
    await generateAiImageWithPexels({ prompt, path });
    return;
  }

  if (geminiKey) {
    await generateAiImageWithGemini({ prompt, path });
    return;
  }

  await generateAiImageWithDalle({ prompt, path, onRetry });
};

export const getGenerateStoryPrompt = (title: string, topic: string) => {
  const language = getTargetLanguageDescription();

  const prompt = `Write a short story with title [${title}] (its topic is [${topic}]).
   You must follow best practices for great storytelling. 
   The script must be 8-10 sentences long. 
   Story events can be from anywhere in the world, but the final text must be written in ${language}. 
   Result result without any formatting and title, as one continuous text. 
   Skip new lines.`;

  return prompt;
};

export const getGenerateImageDescriptionPrompt = (storyText: string) => {
  const language = getTargetLanguageDescription();

  const prompt = `You are given story text.
  Generate (in ${language}) 5-8 very detailed image descriptions for this story. 
  Return their description as json array with story sentences matched to images. 
  Story sentences must be in the same order as in the story and their content must be preserved.
  Each image must match 1-2 sentence from the story.
  Images must show story content in a way that is visually appealing and engaging, not just characters.
  Give output in json format:

  [
    {
      "text": "....",
      "imageDescription": "..."
    }
  ]

  <story>
  ${storyText}
  </story>`;

  return prompt;
};

const saveBufferToFile = (buffer: Buffer, filePath: string) => {
  fs.writeFileSync(filePath, buffer as Uint8Array);
};

const estimateDurationSeconds = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(words * 0.4, 1);
};

export const buildAlignmentFromText = (
  text: string,
  durationSeconds: number,
): CharacterAlignmentResponseModel => {
  const characters = Array.from(text);

  if (characters.length === 0) {
    return {
      characters: [],
      characterStartTimesSeconds: [],
      characterEndTimesSeconds: [],
    };
  }

  const safeDuration = durationSeconds > 0 ? durationSeconds : estimateDurationSeconds(text);
  const perCharDuration = safeDuration / characters.length;
  const characterStartTimesSeconds: number[] = [];
  const characterEndTimesSeconds: number[] = [];

  for (let i = 0; i < characters.length; i++) {
    characterStartTimesSeconds.push(i * perCharDuration);
    characterEndTimesSeconds.push((i + 1) * perCharDuration);
  }

  return {
    characters,
    characterStartTimesSeconds,
    characterEndTimesSeconds,
  };
};

const getAudioDurationSeconds = async (
  filePath: string,
): Promise<number | null> => {
  try {
    const metadata = await parseFile(filePath);
    return metadata.format.duration ?? null;
  } catch (error) {
    console.warn("Unable to read audio metadata", error);
    return null;
  }
};

const saveBase64ToMp3 = (data: string, path: string) => {
  const buffer = Buffer.from(data, "base64");
  saveBufferToFile(buffer, path);
};

const getTargetLanguageDescription = () => {
  const lang = process.env.LANGUAGE?.toLowerCase();

  if (lang && (lang === "pt-br" || lang === "pt_br" || lang === "pt")) {
    return "Brazilian Portuguese";
  }

  return "English";
};

export const generateElevenLabsVoice = async (
  text: string,
  apiKey: string,
  path: string,
): Promise<CharacterAlignmentResponseModel> => {
  const client = new ElevenLabsClient({
    environment: "https://api.elevenlabs.io",
    apiKey,
  });

  const voiceId = "21m00Tcm4TlvDq8ikWAM";

  const data = await client.textToSpeech.convertWithTimestamps(voiceId, {
    text,
  });

  if (!data.alignment || !data.alignment.characterEndTimesSeconds.length) {
    throw new Error("ElevenLabs response missing timestamps");
  }

  saveBase64ToMp3(data.audioBase64, path);
  return data.alignment;
};

export interface LocalTtsConfig {
  url: string;
  model?: string;
  backend?: string;
  voice?: string;
  language?: string;
  responseFormat?: string;
}

export const generateLocalVoice = async (
  text: string,
  config: LocalTtsConfig,
  path: string,
): Promise<CharacterAlignmentResponseModel> => {
  const body: Record<string, unknown> = {
    input: text,
  };

  if (config.model) body.model = config.model;
  if (config.backend) body.backend = config.backend;
  if (config.voice) body.voice = config.voice;
  if (config.language) body.language = config.language;
  if (config.responseFormat) body.response_format = config.responseFormat;

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Local TTS error: ${await res.text()}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  saveBufferToFile(audioBuffer, path);

  const durationSeconds = (await getAudioDurationSeconds(path)) ?? estimateDurationSeconds(text);
  return buildAlignmentFromText(text, durationSeconds);
};

export const getLocalTtsConfigFromEnv = (): LocalTtsConfig | null => {
  const url = process.env.LOCAL_TTS_URL?.trim();
  if (!url) {
    return null;
  }

  const optional = (value?: string) => (value && value.trim().length ? value.trim() : undefined);

  return {
    url,
    model: optional(process.env.LOCAL_TTS_MODEL),
    backend: optional(process.env.LOCAL_TTS_BACKEND),
    voice: optional(process.env.LOCAL_TTS_VOICE),
    language: optional(process.env.LOCAL_TTS_LANGUAGE),
    responseFormat: optional(process.env.LOCAL_TTS_RESPONSE_FORMAT),
  };
};
