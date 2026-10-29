import type { CategoryId } from "@/lib/types";

/**
 * Keyword lists for the AI relevance filter, rule-based categorization and topic tags.
 *
 * Matching rules (see src/lib/pipeline/keywords.ts):
 * - ASCII terms match on word boundaries, case-insensitively.
 * - A leading "=" makes the term case-sensitive ("=AI" will not match "ai" inside words or names).
 * - A trailing "*" allows any word suffix ("fine-tun*" matches fine-tune / fine-tuning).
 * - Terms containing Chinese characters match as substrings.
 */

/** One hit in a title is enough to count as AI news. */
export const AI_STRONG: string[] = [
  // 通用概念
  "=AI", "=AGI", "=AIGC", "=GenAI", "=LLM", "=LLMs", "=VLM", "=RAG", "=MCP", "=A2A", "=A2UI", "=AG-UI", "=MoE",
  "artificial intelligence", "machine learning", "deep learning", "neural network*", "large language model*",
  "language model*", "foundation model*", "reasoning model*", "frontier model*", "multimodal", "generative",
  "diffusion model*", "transformer model*", "open-weight*", "open weights", "fine-tun*", "RLHF",
  "reinforcement learning", "retrieval-augmented", "Model Context Protocol", "Agent2Agent", "agentic",
  "AI agent*", "coding agent*", "computer use", "function calling", "tool calling", "vibe coding", "chatbot*",
  "text-to-video", "image-to-video", "text-to-image", "video generation", "image generation", "superintelligence",
  "inference engine", "context window", "prompt engineering", "embedding model*", "speech model*",
  // 公司、模型与产品
  "OpenAI", "ChatGPT", "=GPT", "GPT-*", "Sora", "Codex", "Anthropic", "Claude", "Gemini", "DeepMind", "Gemma",
  "NotebookLM", "Imagen", "=Veo", "Llama", "Mistral", "Mixtral", "Voxtral", "Qwen", "DeepSeek", "Kimi",
  "Moonshot AI", "=GLM", "Zhipu", "MiniMax", "Doubao", "Seedance", "Seedream", "Hunyuan", "=ERNIE", "=Grok",
  "=xAI", "Copilot", "=Cursor", "Windsurf", "Devin", "Perplexity", "Hugging Face", "HuggingFace", "Ollama",
  "vLLM", "llama.cpp", "=GGUF", "LoRA", "Midjourney", "Stable Diffusion", "=FLUX", "Kling", "=Runway", "=Pika",
  "Hailuo", "Vidu", "ElevenLabs", "Suno", "Nemotron", "LangChain", "LlamaIndex", "Manus", "Dify", "=Coze",
  "SWE-bench", "=MMLU", "Claude Code", "Gemini CLI",
  // 中文
  "人工智能", "大模型", "大语言模型", "语言模型", "智能体", "多模态", "生成式", "机器学习", "深度学习", "神经网络",
  "具身智能", "通用人工智能", "文生图", "文生视频", "图生视频", "视频生成", "图像生成", "语音合成", "语音大模型",
  "数字人", "AI短剧", "AI 短剧", "漫剧", "提示词", "推理模型", "开源模型", "强化学习", "微调", "算力", "智算",
  "豆包", "通义", "千问", "文心", "混元", "智谱", "月之暗面", "阶跃星辰", "百川智能", "零一万物", "稀宇", "可灵",
  "即梦", "海螺", "生数科技", "元宝", "扣子", "秘塔", "模型发布",
];

/** Need two distinct hits (or one weak hit plus a strong one) to count as AI news. */
export const AI_WEAK: string[] = [
  "agent*", "model*", "inference", "robot*", "robotics", "automation", "transformer*", "embedding*", "quantiz*",
  "benchmark*", "=GPU*", "=TPU*", "NVIDIA", "=CUDA", "prompt", "prompts", "prompting", "token*", "dataset*",
  "training", "humanoid*",
  "autonomous", "self-driving", "chip*", "datacenter*", "data center*", "copyright", "deepfake*",
  "机器人", "人形机器人", "自动驾驶", "芯片", "英伟达", "数据中心", "模型", "训练", "推理", "智能", "自动化",
];

export interface CategoryRule {
  terms: string[];
  /** Weight per hit; title hits count triple. */
  weight: number;
}

export const CATEGORY_RULES: Record<CategoryId, CategoryRule[]> = {
  multimodal: [
    {
      weight: 4,
      terms: [
        "Sora", "=Veo", "Kling", "可灵", "Seedance", "Seedream", "即梦", "=Runway", "=Pika", "Hailuo", "海螺", "Vidu",
        "Midjourney", "Stable Diffusion", "=FLUX", "Imagen", "Suno", "ElevenLabs", "Voxtral", "LTX*",
        "text-to-video", "image-to-video", "text-to-image", "text-to-speech", "video generation", "image generation",
        "image editing", "video model*", "image model*", "world model*", "视频生成", "文生视频", "图生视频", "文生图",
        "图像生成", "图像编辑", "视频模型", "世界模型", "AI短剧", "AI 短剧", "漫剧", "短剧", "数字人", "语音合成",
        "语音识别", "音乐生成", "3D 生成", "3D生成", "transcription", "transcribe", "speech-to-text", "voice model*",
        "Genie *",
      ],
    },
    {
      weight: 2,
      terms: [
        "multimodal", "多模态", "computer vision", "vision-language", "vision model*", "视觉", "video", "视频",
        "image*", "图像", "speech", "voice", "语音", "=TTS",
        "=ASR", "audio", "音频", "music", "音乐", "=OCR", "3D", "omni", "全模态", "avatar*", "animation", "动画",
      ],
    },
  ],
  agent: [
    {
      weight: 4,
      terms: [
        "=MCP", "Model Context Protocol", "=A2A", "Agent2Agent", "=A2UI", "=AG-UI", "agentic", "AI agent*",
        "coding agent*", "Claude Code", "Codex", "Gemini CLI", "=Cursor", "Windsurf", "Copilot", "Devin",
        "computer use", "browser use", "function calling", "tool calling", "tool use", "vibe coding", "LangChain",
        "LlamaIndex", "CrewAI", "AutoGen", "Dify", "=Coze", "扣子", "Manus", "n8n", "智能体", "AI 编程", "AI编程",
        "编程助手", "Agent Skills",
      ],
    },
    {
      weight: 2,
      terms: [
        "agent*", "Agent", "workflow*", "工作流", "=RAG", "retrieval", "=SDK", "=API", "=CLI", "=IDE", "plugin*", "插件",
        "automation", "自动化", "assistant*", "助手", "browser", "浏览器", "terminal", "prompt", "prompts", "提示词",
        "memory", "记忆", "tool*", "工具",
      ],
    },
  ],
  model: [
    {
      weight: 4,
      terms: [
        "open-weight*", "open weights", "foundation model*", "reasoning model*", "frontier model*", "开源模型",
        "基座模型", "推理模型", "模型发布", "新模型", "=MoE",
      ],
    },
    {
      weight: 2,
      terms: [
        "GPT-*", "=GPT", "Claude Opus", "Claude Sonnet", "Claude Haiku", "Opus *", "Sonnet *", "Gemini *", "Gemma*",
        "Llama *", "Llama-*", "Qwen*", "DeepSeek-*", "DeepSeek V*", "DeepSeek R*", "Kimi K*", "=GLM-*", "MiniMax-*",
        "Mistral Large*", "Mistral Medium*", "Mistral Small*", "=Grok *", "Nemotron*", "Phi-*", "=Seed1*", "=Seed2*",
        "豆包大模型", "benchmark*", "=SOTA", "榜单", "评测", "parameters", "参数", "checkpoint*", "weights",
      ],
    },
    {
      weight: 1,
      terms: [
        "release*", "launch*", "introducing", "introduces", "announc*", "unveil*", "debut*", "发布", "推出", "上线",
        "开源", "language model*", "大模型", "大语言模型",
      ],
    },
  ],
  opensource: [
    {
      weight: 4,
      terms: ["github.com", "GitHub", "Show HN", "open-source", "open source", "开源项目", "开源框架", "开源工具", "开源库"],
    },
    {
      weight: 2,
      terms: ["repo", "repos", "repository", "self-host*", "自托管", "=npm", "PyPI", "开源"],
    },
    {
      weight: 1,
      terms: ["library", "framework", "toolkit"],
    },
  ],
  paper: [
    {
      weight: 4,
      terms: [
        "arXiv", "paper*", "论文", "NeurIPS", "=ICLR", "=ICML", "=CVPR", "=ACL", "=EMNLP", "=AAAI", "preprint",
        "顶会", "最佳论文",
      ],
    },
    {
      weight: 2,
      terms: ["we propose", "提出", "theory", "理论", "scaling law*"],
    },
    {
      weight: 1,
      terms: ["research*", "study", "研究", "method*", "方法", "实验"],
    },
  ],
  industry: [
    {
      weight: 3,
      terms: [
        "funding", "raises", "raised", "valuation", "=IPO", "acquisition", "acquires", "acquired", "lawsuit", "sues",
        "regulation", "policy", "earnings", "revenue", "layoff*", "partnership", "融资", "估值", "上市", "收购", "诉讼",
        "监管", "政策", "财报", "营收", "裁员", "合作", "投资", "独角兽",
      ],
    },
    {
      weight: 1,
      terms: [
        "=CEO", "pricing", "subscription", "enterprise", "market", "users", "app", "data center*", "chip*", "=GPU*",
        "价格", "订阅", "企业", "市场", "用户", "应用", "产品", "手机", "眼镜", "芯片", "数据中心", "算力",
      ],
    },
  ],
};

/** Ties between categories resolve in this order (more specific first). */
export const CATEGORY_PRIORITY: CategoryId[] = [
  "multimodal",
  "agent",
  "model",
  "paper",
  "opensource",
  "industry",
];

/** Topic tags shown on cards and included in search. */
export const TOPICS: { label: string; terms: string[] }[] = [
  { label: "Agent", terms: ["agentic", "AI agent*", "agents", "智能体", "Agent"] },
  { label: "MCP", terms: ["=MCP", "Model Context Protocol"] },
  { label: "A2A", terms: ["=A2A", "Agent2Agent"] },
  { label: "A2UI", terms: ["=A2UI", "=AG-UI", "generative UI", "生成式 UI", "生成式UI"] },
  { label: "AI 编程", terms: ["Claude Code", "Codex", "=Cursor", "Copilot", "Windsurf", "vibe coding", "coding agent*", "Gemini CLI", "AI 编程", "AI编程"] },
  { label: "视频生成", terms: ["Seedance", "Sora", "=Veo", "Kling", "可灵", "=Runway", "Hailuo", "海螺", "Vidu", "text-to-video", "image-to-video", "video generation", "视频生成", "文生视频", "图生视频"] },
  { label: "AI 短剧", terms: ["AI短剧", "AI 短剧", "短剧", "漫剧"] },
  { label: "图像生成", terms: ["Seedream", "Midjourney", "Stable Diffusion", "=FLUX", "Imagen", "image generation", "text-to-image", "文生图", "图像生成"] },
  { label: "语音", terms: ["=TTS", "speech", "voice", "语音", "Voxtral", "ElevenLabs"] },
  { label: "开源模型", terms: ["open-weight*", "open weights", "开源模型", "=GGUF"] },
  { label: "推理模型", terms: ["reasoning model*", "推理模型"] },
  { label: "具身智能", terms: ["embodied", "具身", "humanoid*", "人形机器人", "robotics"] },
  { label: "RAG", terms: ["=RAG", "retrieval-augmented"] },
  { label: "本地部署", terms: ["Ollama", "llama.cpp", "vLLM", "local LLM*", "本地部署", "LM Studio"] },
];
