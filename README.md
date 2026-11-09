# sticker-assets（A 仓库：小智表情资源库）

小智独立表情服务的 **A 仓库**：图片原件、模板素材、manifest 分片、派生检索索引、最小操作事件与许可说明。
B 仓库 `sticker-api`（Vercel Node API）是唯一的在线写入方；本仓库是**唯一图库权威**。
与 B 的接口约定见 **[CONTRACT.md](CONTRACT.md)**（schema 路径、字段、索引格式、提交协议）。

> 当前状态：P1 本地开发。**未创建远程仓库、未推送、未部署**。下文中的 `{owner}/{repo}` 在远程仓库获批创建前均为占位。

## 公开边界（必读）

本仓库计划**公开**。因此：

- 只存**可公开再分发、非敏感、有权利依据**（`self-created` / `license` / `creator-permission`）的图；首批靠人工收藏或获批清单。
- **不存**：群号/用户 ID/昵称/聊天记录、私密授权截图、token/密钥、原始 Idempotency-Key、举报原文、真人隐私图、付费水印图。校验脚本会拦截常见身份字段与密钥模式，但它不是隐私审核的替代。
- 权利待定（`pending`）的图留在维护者本机私密候选区，**不进本仓库**。
- **删除边界**：下架 = 提交 tombstone（记录保留、当前树删除对象文件），B 在有界刷新窗口内停止出图；但 **Git 历史、fork、clone、镜像缓存、旧直链中的副本无法保证撤回**。需要私密图或强删除时应更换存储架构，而不是依赖本仓库。
- 发布前须剥离 EXIF/GPS/文本元数据（`lib/strip.mjs` 做结构级剥离并保证 GIF 帧数不变）；含元数据的对象会被校验拒绝。
- 容量自设上限：**3000 张或 500 MiB（受管文件当前树总字节），先到先停**；250 MiB 预警。每日成功发布 ≤100 张 / 40 MiB（Asia/Manila 自然日）。Git 历史体积需另行低频检查。

## 目录

```text
sticker-assets.json         版本标识（schemaVersion / indexFormat / tokenizer）
schemas/v1/                 JSON Schema 2020-12（asset、manifest-shard、event、template、license、budget、index-*、mirrors）
config/                     taxonomy（分类枚举）、synonyms（有限同义词）、limits（全部上限）、mirrors（镜像候选）
objects/sha256/<hh>/<sha256>.<png|jpg|gif>   发布字节，文件名即 SHA-256
manifests/<hh>.json         资产记录分片（含 archived / tombstoned）
events/<oo>/<operationId>.json   最小操作事件（无身份信息）
templates/<id>/<version>/   轻模板（声明式 template.json + 素材）
licenses/                   公开许可/授权说明
budgets/daily/<date>.json   每日成功发布量
indexes/                    派生索引：catalog / recent / terms/<tt> / docs/<hhh>（可全量重建）
lib/                        零依赖纯 ESM：校验、分词、索引、提交计划、检索、URL、元数据剥离（B 可按固定 commit vendoring）
scripts/                    validate / build-index / gen-fixtures / capacity-sim / collect-placeholder
fixtures/sample-repo/       自绘测试图构成的完整迷你 A 树（B 的测试可直接读取）
test/                       node:test 单元测试
.github/workflows/          validate（push/PR）、rebuild-index（手动）、collect（占位，默认关闭）
```

## 常用命令（Node ≥ 22，无需 npm install）

```bash
npm run validate            # 校验本仓库
npm run check-index         # 索引是否与全量重建逐字节一致
npm run build-index         # 全量重建 indexes/
npm run validate:fixture    # 校验 fixtures/sample-repo
npm test                    # 单元测试
npm run capacity-sim        # 3000 条合成元数据的分片大小与最坏查询读入量
npm run ci                  # 以上全部
npm run gen-fixtures        # 重新生成 fixture（JPEG 源在 macOS 首次用 sips 生成并剥离元数据后缓存于 fixtures/sources/）
```

## 镜像 URL 模板（锚定 commit + path，raw 回退）

URL 一律由**完整 40 位 commit SHA + 固定路径**拼成，不用分支名，不用 Contents API 临时 `download_url`：

| 顺序 | 源 | 模板 | 状态 |
|---|---|---|---|
| 1 | gh-proxy（社区免费代理） | `https://gh-proxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` | **默认关闭**，未验收 |
| 2 | ghfast（社区免费代理） | `https://ghfast.top/https://raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` | **默认关闭**，未验收；有封锁/换域风险 |
| 最后 | GitHub raw 源站 | `https://raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` | 始终保留作回退 |

- 配置在 `config/mirrors.json`，`lib/urls.mjs#candidateUrls()` 只返回 `enabled && verifiedAt` 的镜像，再追加 raw。host 必须在 `allowedHosts` 内，客户端不能传任意 proxy。
- 镜像是**无 SLA 的社区代理**，不是“一线 CDN”。启用某镜像前须完成验收矩阵（自制 PNG/JPEG/GIF、实际 SHA-256、Content-Type、HTML 代图、重定向、缓存/刷新、速率、失败回退、box 与用户 Mac/大陆网络分别测），通过后填写 `verifiedAt`。
- 小智取图后必须校验 SHA-256；不得向镜像转发 Authorization/cookie/token；不支持私库镜像。全部源失败就明确失败，不自动切付费 CDN。

## Actions 边界

- `validate.yml`：push / PR，只读；检测 force-push 即失败（提示暂停写入与出图核验）。
- `rebuild-index.yml`：仅手动，`contents: write`，同一 run 内校验后**非 force** 推送 main。
- `collect.yml`：授权来源更新占位，**默认关闭**（需 `COLLECT_ENABLED=true`，仅 `workflow_dispatch`，无已批准适配器、不联网）。B 站等来源要过“Actions 用途”和“来源再分发许可”两道独立关口。
- 用户触发的在线作业（上传、搜索、制图、删除）只走 B，不 dispatch Actions 等结果。

第三方 action 均按 commit SHA 固定（`actions/checkout` v7.0.1、`actions/setup-node` v7.1.0，2026-11-09 核对）。
