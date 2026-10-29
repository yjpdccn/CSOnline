# AI 日报

每天打开一个页面，就能看到大模型、Agent 和 AI 工具的最新动态。

AI 日报自动抓取官方博客、Hugging Face、Hacker News、GitHub、Reddit 和中英文科技媒体，筛出与 AI 相关的内容，去重、分类后按天展示。如果配置了大模型接口，还会为英文资讯生成中文标题和一句话摘要，并写一段「今日要点」。

线上地址：<https://yjpdccn.github.io/CSOnline/>（部署方法见下文）

- **一个页面看全**：默认按重要性排序，只列出最近 24 小时最重要的 20 条（数量见 `src/config/site.ts` 的 `topStories`），其余和更早的日期折叠在「更多」里；切到「最新」可按时间逐天查看全部。顶部的今日要点就是这份排序的前几条。支持按分类（模型发布 / Agent 与工具 / 多模态与视频 / 开源项目 / 论文 / 产品与行业）、按来源筛选和全文搜索，筛选条件会写进网址，方便收藏。
- **35 个已验证可用的公开来源**：无需登录。来源都在 [`src/config/sources.ts`](src/config/sources.ts) 里，新增一个来源只要加一行。
- **自动更新**：部署到 GitHub Pages 后，GitHub Actions 每 12 小时抓取一次（北京时间 08:00、20:00 前完成）。本地运行时有「立即更新」按钮，开发服务器也会每 12 小时自动更新。
- **历史累积**：数据以 JSON 存在 `data/`，每次更新由工作流提交回仓库，旧内容不会丢失，页面底部可以逐天加载更早的内容。
- **国内可访问**：纯静态页面，不使用 Google 字体、CDN、统计脚本等境外依赖，也不依赖 Vercel 域名。
- **AI 摘要可选**：在仓库里添加一个 `LLM_API_KEY` 密钥即可开启，默认用智谱免费模型 `glm-4.7-flash`，也可以换成 DeepSeek、通义千问等任意 OpenAI 兼容接口。没有配置时自动回退为原标题和原摘要，不影响使用。

## 本地运行

需要 Node.js 20 以上（推荐 22）。

```bash
npm install
npm run dev
```

打开 <http://localhost:4826>。仓库自带一份数据，打开即可看到内容；点右上角「立即更新」会立刻抓取最新资讯（约 10 秒，开启 AI 摘要时约 1～2 分钟）。开发服务器运行期间，如果距上次更新超过 12 小时，会自动更新一次。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发服务器（端口 4826），带手动刷新与定时更新 |
| `npm run refresh` | 在命令行抓取一次并写入 `data/`（加 `-- --no-llm` 跳过 AI 摘要，`-- --only=openai,qwen` 只抓指定来源） |
| `npm run dedupe` | 不抓取，按当前规则重新合并最近 30 天的重复报道并打印结果（加 `-- --write` 写入 `data/`，加 `-- --misses` 列出相近但未合并的条目） |
| `npm run rank` | 打印最近一次更新时的重要性排序和每条的得分构成（加 `-- --all` 显示全部） |
| `npm run sources:check` | 逐个测试来源是否可用，不写入数据（加 `-- --all` 包括已关闭的来源） |
| `npm run build:static` | 构建 GitHub Pages 用的静态站点到 `out/` |
| `npm test` / `npm run lint` / `npm run typecheck` | 单元测试 / 代码检查 / 类型检查 |

想在本地预览静态站点：`npm run build:static`，然后用任意静态服务器打开 `out/`（例如 `npx serve out`）。按线上子路径 `/CSOnline/` 预览的方法见「部署到 GitHub Pages」。

## AI 中文摘要（可选）

摘要模块走 OpenAI 兼容的 `/chat/completions` 接口，一次只发一个请求，每批 20 条。为了适应免费额度，每次运行最多处理 100 条，先处理英文资讯（中文标题最有用）和最新的内容，剩下的留给之后的定时更新慢慢补齐；之后再发 1 次请求做跨语言合并重复（见「跨来源合并」），最后 1 次请求生成今日要点。英文资讯会得到中文标题和一句话摘要，中文资讯只生成一句话摘要；模型给出的分类会覆盖关键词规则的分类。

这三步共用同一套节奏和上限：请求之间至少间隔 3 秒，每次运行的 AI 部分最长 10 分钟（摘要最多用到约 6 分钟，其余留给合并重复和今日要点），总请求数（含重试）不超过 20 次。遇到限流或模型繁忙（HTTP 429、5xx、超时）时，会按接口给的 `Retry-After` 或逐步加长的间隔重试（智谱 1305「模型访问量过大」至少等 20 秒）；仍然不行就结束本次摘要，这些资讯不算失败，下次更新再试。合并重复是可选的，只试一次，模型繁忙时直接跳过，把时间留给今日要点。AI 出问题不会让工作流失败，也不会耽误页面发布；页面上只显示已完成和待生成的数量，需要你处理的情况（密钥无效、欠费等）才会给出提示。

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_API_KEY` | 接口密钥 | 无（不配置就是回退模式） |
| `LLM_BASE_URL` | 接口地址，不含 `/chat/completions` | `https://open.bigmodel.cn/api/paas/v4`（智谱） |
| `LLM_MODEL` | 模型名。智谱默认 `glm-4.7-flash`，其他服务需要填写 | 见左 |
| `LLM_BATCH_SIZE` | 每次请求包含的条数 | `20` |
| `LLM_MAX_ITEMS` | 每次运行最多生成摘要的条数，其余留到之后的更新 | `100` |
| `LLM_TIME_BUDGET_MS` | 每次运行 AI 部分（摘要、合并重复、今日要点）的总时间上限（毫秒） | `600000`（10 分钟） |
| `LLM_MAX_REQUESTS` | 每次运行最多发起的 AI 请求数（含重试、合并重复和今日要点） | `20` |
| `LLM_MIN_INTERVAL_MS` | 两次请求的最小间隔 | 智谱为 `3000`，其他服务 `500`～`1000` |
| `LLM_TIMEOUT_MS` | 单次请求的超时 | `150000` |
| `LLM_EXTRA_BODY` | 额外请求参数（JSON），例如 `{"thinking":{"type":"disabled"}}` | 智谱默认关闭思考模式 |
| `LLM_DISABLED` | 设为 `1` 时强制不用 AI 摘要 | — |

本地使用时，把 [`.env.example`](.env.example) 复制成 `.env.local` 并填写，`npm run dev` 和 `npm run refresh` 都会读取。常见配置：

| 服务 | `LLM_BASE_URL` | `LLM_MODEL` | 说明 |
| --- | --- | --- | --- |
| 智谱 GLM（默认） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7-flash` | 免费模型，国内直连，GitHub Actions 也能访问；只需设置 `LLM_API_KEY` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | 付费 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 如 `qwen-plus` | 付费，有免费额度 |
| Kimi | `https://api.moonshot.cn/v1` | 按控制台填写 | 付费 |

GitHub Models 已于 2026 年 7 月 30 日[停止服务](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)，不能再用内置的 `GITHUB_TOKEN` 免费调用模型；仍指向它的配置会被跳过，并在「数据状态」里提示改用其他接口。

**会超额度或花钱吗？** 按智谱官方[价格页](https://open.bigmodel.cn/pricing)，`glm-4.7-flash` 的输入、输出和缓存都免费，没有写 token 上限；[速率限制文档](https://docs.bigmodel.cn/cn/api/rate-limit)只限制「同一时刻正在处理的请求数」（并发数），按账户的[用户权益等级](https://docs.bigmodel.cn/cn/guide/platform/equity-explain)分档，具体数字在控制台的[速率限制](https://bigmodel.cn/usercenter/proj-mgmt/rate-limits)页面查看。只用免费模型不会产生积分，账户会停留在基础等级 V0。本项目一次只发一个请求，不会超过并发限制；常见的报错是 1302（本账户请求太密）和 1305（模型整体访问量过大，与账户无关），都会自动退避重试，留到下次更新补齐。只要 `LLM_MODEL` 保持 `glm-4.7-flash` 就不会扣费；换成付费模型才会按量计费，欠费时接口返回 1113，本项目会停止调用并在页面上提示。每天两次更新各约 7～10 次请求（摘要 5 次左右，加上合并重复和今日要点各 1 次）。

## 部署到 GitHub Pages（免费，定时更新）

| | 地址 |
| --- | --- |
| 仓库 | <https://github.com/yjpdccn/CSOnline> |
| 网站 | <https://yjpdccn.github.io/CSOnline/> |
| 手动运行更新 | <https://github.com/yjpdccn/CSOnline/actions/workflows/refresh.yml> |

项目已经包含工作流 [`.github/workflows/refresh.yml`](.github/workflows/refresh.yml)：每 12 小时抓取资讯、生成摘要、把 `data/` 提交回仓库，再构建静态站点并发布到 GitHub Pages。站点挂在子路径 `/CSOnline/` 下，这个路径由 `actions/configure-pages` 输出的 `base_path` 传给构建（`PAGES_BASE_PATH`），以后改仓库名或绑定自定义域名都不用改代码。

一次性设置（在 GitHub 仓库页面操作）：

1. **启用 Pages**：**Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. **允许工作流写入仓库**：**Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions** 并保存。工作流需要把新数据提交回 `main`。
3. **（推荐）开启 AI 中文摘要**：在 <https://open.bigmodel.cn> 注册智谱开放平台并创建一个 API Key，然后在 **Settings → Secrets and variables → Actions → Secrets → New repository secret** 新建 `LLM_API_KEY`，值填这个密钥。只设置这一项就会使用免费的 `glm-4.7-flash`。要换成其他服务，再在同一页面的 **Variables** 中新建 `LLM_BASE_URL` 和 `LLM_MODEL`（见上文表格）。不设置也能正常运行，只是英文资讯显示原标题。
4. **把代码推到 `main`**：
   ```bash
   git push https://github.com/yjpdccn/CSOnline.git HEAD:main
   ```
   推送会自动触发一次工作流（**Actions → 更新资讯并部署**），约 3～5 分钟后打开 <https://yjpdccn.github.io/CSOnline/>。如果推送时还没完成第 1、2 步，那次运行会失败，补上设置后在 Actions 页面点 **Run workflow** 重跑即可。

之后它会按计划自动运行，也可以随时在 Actions 页面手动运行。网站右上角的「手动更新」按钮会直接打开这个工作流页面（静态站点没有服务器，不能在页面里直接刷新）。

在本地按线上路径预览：`PAGES_BASE_PATH=/CSOnline npm run build:static`，把 `out/` 复制到任意目录下的 `CSOnline/` 子目录，再用静态服务器打开该目录，访问 `/CSOnline/`。

### 调整更新时间

- GitHub 的 cron 使用 UTC。默认 `30 23,11 * * *` 即北京时间 07:30 和 19:30 开始运行，页面通常在 08:00 / 20:00 前更新好。高峰期 GitHub 可能延迟几分钟到几十分钟。
- 改成每天一次：把 cron 改为 `"30 23 * * *"`。同时把 [`src/config/site.ts`](src/config/site.ts) 里的 `scheduleLabel` 改成对应文字。
- 本地服务器模式的间隔由 `REFRESH_INTERVAL_HOURS` 控制（默认 12，设为 24 即每天一次）。

### 为什么要把数据提交回仓库

- **历史累积**：每次运行都基于仓库里的 `data/` 增量更新，旧资讯不会丢失。
- **定时任务不被停用**：GitHub 会在公开仓库 60 天没有活动时自动停用定时工作流，每次更新提交的数据正好保持了仓库活跃。
- 工作流用 `GITHUB_TOKEN` 推送，不会再次触发自身，不会循环运行。

### 国内访问说明

- 页面只使用系统字体，不加载 Google Fonts、gstatic、统计脚本或任何第三方 CDN；所有脚本、样式、数据都来自 `github.io` 本身。
- `*.github.io` 在国内大多数网络可以直接访问，但速度会有波动；如果需要更稳定，可以在 Pages 设置里绑定自己的域名。
- 资讯原文链接指向各来源网站，其中部分境外网站（如 Reddit）在国内可能无法打开，这与本站无关。

## 数据来源

2026-10-29 在开发环境逐一验证（`npm run sources:check -- --all`）。

| 分组 | 来源 | 获取方式 |
| --- | --- | --- |
| 官方博客 | OpenAI、Google AI、Google DeepMind、Google 开发者博客、Google Research、Meta、Meta 工程博客、Microsoft AI、Microsoft Research、NVIDIA、Mistral AI、Apple 机器学习研究、Hugging Face 博客 | RSS / Atom |
| 官方博客 | Anthropic | 解析新闻页面（官方没有 RSS） |
| 官方博客 | 字节跳动 Seed、通义千问 Qwen | 官网使用的公开 JSON 接口（中文标题） |
| 官方博客 | DeepSeek | 文档站 sitemap + 中文新闻页 |
| 社区与开源 | Hacker News（≥100 分且命中 AI 关键词） | HN Algolia API |
| 社区与开源 | HF 每日论文（≥50 赞）、HF 热门模型（过滤量化转存版） | Hugging Face API |
| 社区与开源 | GitHub Trending、GitHub 新星项目（近 7 天创建、≥200 星） | Trending 页面 / GitHub 搜索 API |
| 社区与开源 | r/LocalLLaMA | Reddit RSS |
| 博主 | 宝玉（baoyu.io）、Simon Willison | RSS / Atom |
| 中文媒体 | 机器之心 | 官网 JSON 接口 |
| 中文媒体 | 36氪 AI 频道、36氪快讯 | 36氪网关接口（网页有 JS 验证） |
| 中文媒体 | 量子位、雷峰网、极客公园、InfoQ 中文 | RSS |
| 英文媒体 | TechCrunch AI、The Verge AI、The Decoder | RSS |

**可用但默认关闭**（内容偏消费电子或数量太多）：IT之家、钛媒体、开源中国。把对应行的 `enabled: false` 删掉即可启用。

**没有采用的来源**：

- 微博（宝玉xp）和 X（@dotey）：需要登录，公共 RSSHub（rsshub.app）返回 403，Nitter 镜像已失效，没有可靠的公共路由。配置里保留了两条默认关闭的模板，自建 RSSHub 并配置 Cookie 后，设置 `RSSHUB_BASE_URL` 再启用即可。宝玉的内容通过他的博客 baoyu.io 的 RSS 收录。
- Microsoft AI Blog 旧订阅源（返回 410，已换成 Microsoft Source 的 AI 订阅源）、Meta AI 博客（拒绝非浏览器请求，由 Meta Newsroom 和工程博客覆盖）、xAI（403）、虎嗅（超时）、Qwen 旧博客订阅源（2025 年 9 月后停更，已换成 qwen.ai 接口）、hnrss.org（不稳定，已换成 Algolia API）。

**在 GitHub Actions 上的注意事项**：Reddit 经常拒绝云服务器 IP，r/LocalLLaMA 在工作流里可能抓取失败。单个来源失败不影响其他来源，失败原因会显示在页面的「数据状态」中。

### 添加一个来源

在 [`src/config/sources.ts`](src/config/sources.ts) 加一行，例如任意 RSS：

```ts
{ id: "my-feed", name: "我的来源", group: "media-zh", type: "rss", url: "https://example.com/feed", lang: "zh" },
```

- 只发 AI 内容的来源加 `aiFocused: true`，跳过关键词过滤。
- `category` 强制分类，`defaultCategory` 是关键词规则没有命中时的分类。
- 然后运行 `npm run sources:check -- --only=my-feed` 确认能抓到数据。

非 RSS 来源需要在 `src/lib/pipeline/fetchers/` 里写一个抓取函数并注册到 `fetchers/index.ts`。

## 工作原理

```
抓取（并发 6，单源失败隔离）
  → 只保留最近 7 天
  → AI 相关性过滤（关键词表见 src/config/keywords.ts，含模型、Agent、MCP/A2A/A2UI、Seedance/Sora/Veo/可灵等）
  → 去重：同一链接 / 同一 GitHub 仓库 / 同一论文直接合并
  → 分类（关键词打分，AI 摘要可修正）与热度评分
  → 跨来源合并：同一事件的不同报道归为一张卡片，其余报道显示为「也见于」
  → AI 摘要（可选，只处理每张卡片的主报道）→ AI 补充合并中英文报道（可选）
  → 重要性排序（见下文）→ 今日要点（取排序前列，AI 撰写或自动摘录，同一事件只出现一次）
  → 写入 data/
```

### 跨来源合并

同一件事常被官方博客、Hacker News、英文媒体和中文媒体各报道一次，标题和语言都不同。每次更新都会把最近 14 天的条目重新分组，规则在 [`src/lib/pipeline/similarity.ts`](src/lib/pipeline/similarity.ts) 和 [`cluster.ts`](src/lib/pipeline/cluster.ts)，不依赖大模型：

- **标题归一化**：去掉「刚刚」「重磅」「Introducing」「Show HN」等前缀和标点，中文按字的二元组比较，英文按词比较，常见词（模型、发布、AI、launch…）权重很低。
- **实体与数字**：识别带版本号的模型名（`Gemini 4 Carbon`、`GPT-6.1 Terra`、`K3.1 Pro`）、中英文公司名（谷歌 = Google）和带单位的数字（`200亿美元` = `$20B`，`350亿参数` = `35B`）。两篇报道都以同一个模型名开头，且相隔不到 36 小时，就算同一事件，中文和英文报道也能这样合并。
- **不会合并**：同一模型的不同版本或型号（GLM-5.3 与 GLM-5.5、GPT-6.1 Sol 与 Terra）、金额不同的报道、标题主体不同的同公司发布（腾讯 Buddy One 与混元 Hy4）、只共享一个数字或公司名的报道、「极客早知道」这类多条新闻的汇总，以及同一来源的两篇不同文章（除非标题或摘要几乎相同）。
- **时间窗口**：72 小时；GitHub 仓库和 Hugging Face 模型页按创建时间计，放宽到 7 天。
- **主报道**：有官方博客（或直接链接官方页面的帖子）时用官方，多篇官方取讨论最多、被其他报道呼应最多的一篇；否则取信息最完整的报道（中文媒体优先，其次英文媒体、博主、社区帖子和仓库页）。其余报道显示为「也见于」，点开可以看到每篇的标题和时间。被合并的条目不再单独计入分类、来源数量和今日要点，按来源筛选时，只要某个来源报道过这件事，这张卡片就会显示。
- **AI 补充（可选）**：配置了 `LLM_API_KEY` 时，每次更新会多发 1 次请求，让模型找出最近 48 小时里没有共同名称的中英文同一事件报道，结果保存在 `data/same-event.json`，以后的更新即使不调用模型也会保留这些合并；上面的「不会合并」规则仍然有效。模型不可用时只是少合并几条，其余照常。

调整规则后，用 `npm run dedupe` 查看合并结果，`npm run dedupe -- --misses` 检查有没有该合并却没合并的条目。

### 重要性排序

页面默认（「重要」）和今日要点用同一份排序，规则在 [`src/lib/pipeline/importance.ts`](src/lib/pipeline/importance.ts) 和 [`src/lib/rank.ts`](src/lib/rank.ts)。每张卡片（合并后的一件事）的得分由几部分相加：

- **来源权威**：取卡片里最权威的来源。大模型公司官方博客（OpenAI、Anthropic、Google DeepMind、DeepSeek 等）最高，其次是官方工程/研究博客和机器之心、量子位、TechCrunch、The Verge 等主流媒体，再次是其他媒体和博主；Hacker News、Reddit、HF 论文与模型页、GitHub 本身权重很低，靠热度说话。直接链接官方页面的讨论帖按官方计。
- **报道面**：除主报道外还有几个不同来源报道（按对数增长，6 个来源约 40 分），同时有中英文报道再加分。
- **热度**：所有报道里最高的 HN 分数和评论数、HF 点赞、GitHub 今日 Star 等，有上限。
- **加分**：带版本号的模型发布（大厂发布或多家报道时 +14，其他 +6）；涉及大厂或其主力产品（OpenAI/ChatGPT、谷歌/Gemini、阿里/通义、字节/豆包、腾讯/混元等）+6。「极客早知道」这类汇总打六折。

总分再按这件事最早一篇报道距更新时间的长短衰减（每 24 小时减半）。排列时同一类来源（HF 模型页、HF 论文、Reddit、HN）和同一来源每多一条依次打折，避免某一类刷屏；GitHub 仓库单独放在「开源项目速览」里，不参与排序。「最新」模式仍按发布时间排列。用 `npm run rank` 可以看到每条的得分构成。

数据文件：

| 文件 | 内容 |
| --- | --- |
| `data/days/YYYY-MM-DD.json` | 每天的资讯（按北京时间分组） |
| `data/index.json` | 所有日期及条数 |
| `data/digests.json` | 每天的今日要点 |
| `data/seen.json` | 已收录条目的指纹（保留 180 天，防止重复收录） |
| `data/same-event.json` | AI 判断为同一事件的条目对（开启 AI 摘要后才会生成，保留 30 天） |
| `data/meta.json` | 最近一次及历史运行记录、各来源状态、AI 摘要状态 |

## 目录结构

```
src/
  config/sources.ts      所有来源
  config/keywords.ts     AI 关键词、分类规则、话题标签
  config/site.ts         站点名称、时区、更新间隔、分类
  lib/pipeline/          抓取、过滤、去重、分类、摘要、存储
  app/                   页面；api/*/route.api.ts 只在本地服务器模式启用
  components/news/       页面组件
scripts/                 refresh / sources:check / 静态数据导出
.github/workflows/       定时更新与 Pages 部署
data/                    累积的资讯数据
```

本地服务器模式（`npm run dev` / `npm start`）每次请求读取 `data/`，提供刷新接口和定时器；静态模式（`npm run build:static`，即 `STATIC_EXPORT=1`）把页面和每天的数据导出成纯文件，供 GitHub Pages 托管。
