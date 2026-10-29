import { fetchJson } from "../http";
import { collapse, truncate } from "../text";
import type { CategoryId, RawItem, SourceConfig } from "@/lib/types";

interface DailyPaper {
  title: string;
  summary?: string;
  publishedAt?: string;
  paper: {
    id: string;
    upvotes?: number;
    ai_summary?: string;
    summary?: string;
    submittedOnDailyAt?: string;
    githubRepo?: string;
  };
  numComments?: number;
}

export async function fetchHfPapers(source: SourceConfig): Promise<RawItem[]> {
  const minUpvotes = Number(source.options?.minUpvotes ?? 30);
  const papers = await fetchJson<DailyPaper[]>(source.url);
  return papers
    .filter((p) => (p.paper.upvotes ?? 0) >= minUpvotes)
    .map((p) => ({
      title: collapse(p.title),
      url: `https://huggingface.co/papers/${p.paper.id}`,
      key: `arxiv:${p.paper.id}`,
      excerpt: truncate(collapse(p.paper.ai_summary || p.summary || p.paper.summary || ""), 280) || undefined,
      publishedAt: p.paper.submittedOnDailyAt ?? p.publishedAt,
      metrics: { upvotes: p.paper.upvotes, comments: p.numComments },
    }));
}

interface HfModel {
  id: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  createdAt?: string;
  trendingScore?: number;
}

/** Quantized or fine-tuned re-uploads crowd the trending list; keep original releases. */
const DERIVATIVE =
  /gguf|awq|gptq|fp8|fp4|nvfp4|int4|int8|w4a16|mlx|exl2|exl3|bnb|4bit|8bit|abliterated|uncensored|heretic|quantized|-q\d|onnx|lora|distill-?gguf/i;

const PIPELINE_LABELS: Record<string, string> = {
  "text-generation": "文本生成",
  "image-text-to-text": "图文理解",
  "video-text-to-text": "视频理解",
  "audio-text-to-text": "音频理解",
  "any-to-any": "全模态",
  "text-to-image": "文生图",
  "image-to-image": "图像编辑",
  "text-to-video": "文生视频",
  "image-to-video": "图生视频",
  "text-to-speech": "语音合成",
  "text-to-audio": "音频生成",
  "automatic-speech-recognition": "语音识别",
  "image-to-3d": "3D 生成",
  "text-to-3d": "3D 生成",
  "feature-extraction": "向量嵌入",
  "sentence-similarity": "向量嵌入",
  translation: "翻译",
  robotics: "机器人",
};

const MULTIMODAL_PIPELINES =
  /image|video|audio|speech|3d|any-to-any/;

export async function fetchHfModels(source: SourceConfig): Promise<RawItem[]> {
  const models = await fetchJson<HfModel[]>(source.url);
  const limit = source.limit ?? 12;
  return models
    .filter((m) => !DERIVATIVE.test(m.id))
    .slice(0, limit)
    .map((m, index) => {
      const tag = m.pipeline_tag ?? "";
      const category: CategoryId = MULTIMODAL_PIPELINES.test(tag) && tag !== "image-text-to-text" ? "multimodal" : "model";
      const parts = [
        `Hugging Face 趋势榜第 ${index + 1} 名`,
        PIPELINE_LABELS[tag] ?? (tag || undefined),
        m.likes ? `${m.likes.toLocaleString("en-US")} 个赞` : undefined,
      ].filter(Boolean);
      return {
        title: m.id,
        url: `https://huggingface.co/${m.id}`,
        key: `hf:${m.id.toLowerCase()}`,
        excerpt: parts.join(" · "),
        publishedAt: m.createdAt,
        lang: "zh" as const,
        category,
        metrics: { likes: m.likes },
        skipLlm: true,
      };
    });
}
