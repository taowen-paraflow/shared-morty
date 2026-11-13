---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty 状态与文件读写约定

设计与实现状态，2026-11-13；Claude 登录和共享写入已实现，Codex 共享认证及个人归档尚未实现。本文按“谁持有状态、谁读、谁写、何时提交”组织。用户操作见 [user-journey.md](./user-journey.md)。

页面按“使用团队账号”“共享 Claude Code”“共享 Codex”分开，公共连接只核实 GitHub 身份及仓库，不查询 Secrets 或启动任务。功能状态由各页持有，不再使用跨功能的 action union / reducer。连接时默认进入使用页查询本人任务。

当前已实现运行控制：launcher 查询本人任务、向默认分支的 `runner.yml` 提交环境检查、手动刷新、重新核验归属后请求停止本人任务。检查任务使用真实 actor id 的 concurrency group，验证默认分支、run 的 actor / event / workflow / request id，只报告共享 Secret 是否存在后退出，不启动 Agent 或 Morty。`SHARED_AUTH_KEY` 存在不代表 `codex.enc` 已验证可用。

Claude 登录使用独立 `login.yml`，与 `runner.yml` 共用 `shared-morty-${{ github.actor_id }}` concurrency group。浏览器创建本人 Issue 和临时公钥，runner 校验真实 run、actor、默认分支、run attempt、Issue 创建者与 request id 后，在隔离 home 中启动固定版本 `claude setup-token`。授权链接、授权码和结果 token 经 Issue 密文交换；浏览器收到 token 后单独点击共享，使用仓库公钥的 LibSodium sealed box 写 `SHARED_CLAUDE_TOKEN`。正常完成后关闭 Issue；关闭失败不改写授权结果。尚未接通聊天。

公开性不是授权边界：只执行可信默认分支，核对 actor / workflow / run attempt。外部读者可读取 Issue 和日志，所以授权链接、授权码、token 仍须加密交换，Secret 不进源码，个人 cache 只含密文；具有发布执行代码权限的人仍属于既有信任边界。

当前实现涉及的状态与读写者：

| 状态 / 文件 | 谁写 | 谁读 | 生命周期 |
| --- | --- | --- | --- |
| 浏览器连接状态与 Session：PAT HTTP client、规范仓库名、GitHub 身份、连接代号 | `connection.ts` 的 `useConnection`；身份与仓库经 GitHub schema 校验 | 页面连接摘要；三个独立功能读取当前 Session | 内存；输入框立即清空。重连取消旧请求并卸载旧功能；连接代号只用于本地组件生命周期，不作为身份依据 |
| 当前入口：使用 / 共享 Claude / 共享 Codex | `view.tsx` 的 Workspace，由本人导航操作更新 | 导航与对应页面 | 默认使用入口；切换不提交 workflow、不发布凭据；重新连接重置 |
| 使用页任务快照：loading / ready / stale / working / failed | `usage-page.tsx`，只接收本人运行查询与操作结果 | 使用页及 `RunnerPanel` | 进入或返回使用页重新查询；离开时卸载并取消未完成请求；stale 禁止凭旧快照启动检查 |
| Claude 共享页：intro / login / working；login 内为授权协议阶段 | `claude-sharing-page.tsx` 调用登录领域函数写入 | `ClaudeLoginPanel` | 切换入口只隐藏，不卸载，保留授权上下文；失败保留可重试结果；共享或取消后返回本功能设置。使用页不读取此状态 |
| Codex 共享页 | 当前无业务状态 | 独立说明页 | 尚未实现，不启动授权或读取 Secrets |
| 浏览器各功能当前请求的 AbortController | `useTask` 按功能独立持有；连接请求由 `useConnection` 持有 | 对应 GitHub / 登录异步操作 | 同一功能同步阻止重复提交；卸载、重连、页面销毁时取消，已取消响应不能写回。切换入口不会取消保留中的 Claude 交换；不代表取消已提交的远端任务 |
| workflow dispatch inputs：检查任务的 `mode=check` / `request_id`；登录任务的 `issue` / `request_id` | launcher | GitHub、对应运行进程 | 不携带凭据、授权码或私钥；提交成功不等于任务已启动 |
| Actions `GITHUB_EVENT_PATH` 指向的事件 JSON | GitHub | 检查或登录入口 | 本次 job 临时文件；校验 schema，再用 job token 核对真实 run |
| job 环境中的 `GH_TOKEN` | GitHub 注入 job token | 运行进程的 GitHub HTTP client | 检查任务 contents / actions read；登录任务另有 issues write。均不传给 Claude 子进程，不授予 Secrets 写入 |
| `SHARED_CLAUDE_AVAILABLE` / `SHARED_CODEX_AVAILABLE` | workflow 根据 Secret 是否为空计算字符串布尔值 | 检查进程 | 只传存在标记，不传 Secret 内容；不进行登录或认证有效性验证 |
| `SHARED_MORTY_DIAGNOSTICS=1` 的结构化诊断日志 | 登录进程 / HTTP client / PTY 适配器 | Actions 日志读者（公开仓库中包括任何人） | 仅固定事件、资源类别、状态码、长度、run / attempt / Issue id 与白名单提示标记；没有原始 URL、输入、终端文本或 token |
| 检查 stdout 的 sanitized JSON / Actions 日志 | 检查进程 | 运行者通过 Actions 页面查看 | 含本人 id、request id、Secret 存在标记及 `chat=not_implemented`，不含凭据或聊天 |
| 浏览器登录临时 RSA 私钥及未共享 Claude token | 本页生成私钥，解密 runner 的 token 消息 | 本页 launcher | 仅内存，私钥不可导出；共享完成、取消或页面销毁后放弃引用，不写浏览器持久存储 |
| 本次 Issue 正文 | launcher | 登录进程 | 协议 v1、本人 id、request id、浏览器公钥、15 分钟 expiresAt；不含凭据 |
| 本次 Issue comments | launcher 写授权码密文；job bot 写 challenge / token / error 密文 | 本次双方 | RSA-OAEP-SHA256 包装 AES-256-GCM key；AAD 绑定仓库、Issue、request、run、attempt、消息类型与期限。网页验证 bot 稳定 id，runner 验证真实用户 id；拒绝重复 code 和混合 attempt |
| 登录目录 `$RUNNER_TEMP/shared-morty-claude-login-<随机后缀>/` | 运行进程创建，Claude 写自己的临时配置 | 仅本次登录子进程 | 同时作为 cwd / HOME / USERPROFILE / TMPDIR / TEMP，不载入个人聊天；子进程退出后运行进程递归删除。VM 强制销毁时依赖平台清理 |
| PTY 和 xterm 内存屏幕 | 官方 Claude CLI 输出，运行进程读取 | 登录适配器 | `script` 日志目标为 `/dev/null`，stdout / stderr 不转发到 Actions 日志；等待授权码明文或“星号遮罩 + 末尾六字符”在屏幕确认后才发送 Enter；不按任意日志文本提取凭据 |
| 仓库 Secret `SHARED_CLAUDE_TOKEN` | 本人 launcher 在显式点击共享后通过 PUT 写入或替换 | 后续 Claude 任务由 GitHub 注入 | 传输使用 GitHub 公钥 sealed box；只有 HTTP 201 / 204 成功才显示共享成功，权限或网络失败保留本页 token 供重试 |

登录进程只传 PATH、临时 home 路径、终端类型、`BROWSER=false`、关闭更新与非必要流量的标记给 Claude；不传成员 PAT、job token、其他 Secrets 或个人密钥。90 秒内必须看到授权入口；整个交换期限从浏览器创建请求起算 15 分钟，包含排队。取消和超时会停止子进程，并有界尝试发送加密错误和关闭 Issue。取消 API 的成功仅表示请求被接收；页面仍需确认任务结束。请求或授权码发送结果不确定时保留本页上下文等待刷新，不自动重发。

当前验证包括真实 HTTP 替身、实际加密与 Secret 解密、外部进程替身，以及下面单独列出的官方固定版本真实运行。已在公开仓库完成真实浏览器到 runner 的 challenge / code 密文往返；首次真实授权因官方 CLI 遮罩输入与旧 fake 不同，在发送 Enter 前失败；合成探测定位后，修正后的真实运行 43358458456 成功确认遮罩输入、发送 Enter、返回 108 字符 token 密文并关闭 Issue。真实浏览器完成解密和 LibSodium Secret 发布，GitHub 元数据确认 `SHARED_CLAUDE_TOKEN` 于 2026-11-13 03:24:30 UTC 创建。另一台 VM 的运行 43359580808 读取新 Secret，官方 `claude auth status` 确认 `loggedIn=true` / `oauth_token`；该次未发起模型对话。后续运行 43366687430 使用同一共享 Secret，在新的隔离 VM 中执行官方 Claude Code 2.1.323 的单轮 Sonnet 请求，返回成功且合成答案校验通过；禁用工具和会话持久化，不输出对话内容。该实测证明共享凭据可用于模型推理，不代表网页 / Morty 聊天、个人历史隔离或多人并发已经实现。观察、修正和公开日志扫描结果见 `experiments/claude-live-results.json`。此前浏览器额外检查被拒绝不再代替这次实际观察；未完成的项目仍不记为通过。此协议是新增 v1，尚无已发布的旧消息对端；原有检查 CLI 输出及保存格式未变。

页面尚不读取环境检查的完整输出，详情在 Actions 查看；Claude 登录状态从加密 Issue 消息读取。以下 Codex 认证、聊天和归档流程仍是待实现设计，Claude 登录部分以本节的实际读写为准。

## 1. 范围与进程名称

系统由静态 launcher、GitHub Actions 和 Morty 组成。源码与执行 workflow 可以放在同一个公开仓库。共享凭据放 GitHub Secrets 或加密文件；个人数据仅存密文；公开日志、Issue 和 cache 不得携带明文秘密。不增加业务数据库、常驻后台服务、额外认证 runner、下载或导出功能。

账号提供者授权一次，团队成员直接使用。每人一个 runner 前缀，同一用户最多一个运行中的 runner，不同用户可以并行；个人历史、文件、Morty 身份和历史密钥彼此独立。

下文固定使用这些名称，不再笼统地把写入者称作“runner”：

| 名称 | 所在位置 | 职责 |
| --- | --- | --- |
| **launcher** | 每个用户的浏览器 | 连接 GitHub、保存个人密钥、启动 / 停止自己的任务；账号提供者在此发起登录和发布 |
| **运行主进程** | 用户已有的 Actions job | 验证身份、Issue 通信、启动子进程、恢复与保存个人状态 |
| **认证模块** | 运行主进程中的模块 | 读取共享凭据；Codex 获取账号锁、调用临时认证进程、提交共享认证密文 |
| **managed-auth 进程** | 同一个 job 内临时启动的官方 Codex app-server 子进程 | 首次登录或刷新完整认证，写自己的临时 `auth.json`；不处理用户聊天 |
| **聊天进程** | 同一个 job 的 Claude Code 或个人 Codex app-server | 处理该用户会话和工具；Codex 使用 external auth，只接收 access token |
| **Morty daemon / adapter** | 同一个 job | 浏览器聊天通信、个人 computer 身份；Codex adapter 负责外部 token 初始化和 refresh 回调 |
| **归档模块** | 运行主进程中的模块 | 停止写入后归档个人目录，用个人密钥加密，读写本人 Actions cache |

认证模块不是新服务，managed-auth 也不是第二个 GitHub runner。一个 job 可以包含这些进程，但只能有一个用户的数据。

## 2. 状态总表：以哪一份为准

| 状态 | 权威保存位置 | 谁写入 | 谁读取 | 何时变化 |
| --- | --- | --- | --- | --- |
| 共享 Claude CI token | GitHub Secret `SHARED_CLAUDE_TOKEN` | 账号提供者的 launcher，通过 Secrets API | GitHub 注入给 Claude 聊天步骤 | 首次共享、重新授权 |
| 共享 Codex 认证加密 key | GitHub Secret `SHARED_AUTH_KEY` | 账号提供者的 launcher | GitHub 注入给认证模块 | 首次设置；常规刷新不换 key |
| **共享 Codex 当前完整认证** | **执行仓库 `auth-state` 分支中的 `codex.enc`** | **持账号锁的认证模块，通过 Contents API** | **认证模块** | **首次共享、刷新提交、重新授权、停用** |
| Codex 刷新中的本地认证 | `T/auth-refresh/<operationId>/codex/auth.json` | 认证模块写输入；managed-auth 进程写更新 | managed-auth 进程；随后由认证模块读取 | 仅一次登录 / 刷新操作期间 |
| 聊天使用的 Codex access token | 个人 app-server 内存 | adapter 通过官方协议交付 | 个人 app-server | 启动、更新认证回调 |
| 个人历史密钥 `historyKey` | 本人 launcher 的 IndexedDB vault | 本人 launcher | 本人 launcher；本次授权的归档模块 | 首次使用生成，浏览器清理后丢失 |
| 当前个人历史和文件 | `U` 下的个人目录 | 聊天进程、工具、Morty daemon | 同一用户的聊天与归档进程 | 用户运行期间 |
| 上次已保存的个人状态 | 本人 Actions cache 中的 `state.enc` | 归档模块和 cache 保存步骤 | 本人下次运行的归档模块 | 正常保存成功时 |
| Codex 账号互斥锁 | Git ref `refs/heads/auth-lock-codex` | 竞争者尝试创建；持有者删除 | 所有认证模块 | 获取 / 刷新共享认证期间 |

**`codex.enc` 才是下一次启动读取的当前认证。** 本地 `auth.json` 在成功提交前只是一次操作的输入 / 结果，不能让其他 runner 据此启动。初始旧 Secret、个人历史归档、聊天进程内存都不能反向覆盖共享认证。

## 3. GitHub 中每个对象的读写者

### 3.1 Secrets 和共享认证文件

| 对象 | 格式 / 内容 | 写入者和写入条件 | 读取者 |
| --- | --- | --- | --- |
| `SHARED_CLAUDE_TOKEN` | 官方 `claude setup-token` 生成的 CI 长期 token | 账号提供者的 launcher；GitHub 用户权限和 PAT 都须允许 Secrets 写入 | GitHub 为 Claude 任务注入，任务只传给所需进程 |
| `SHARED_AUTH_KEY` | 随机 256-bit key | 首次共享 Codex 前由 launcher 生成并通过 Secrets API 保存；重新登录不重建 | 当前 Codex 任务的认证模块；不主动传给聊天进程 |
| `auth-state` 分支上的 `/codex.enc` | AES-256-GCM 信封，包住下面定义的认证状态 | 仅持 `auth-lock-codex` 的认证模块；Contents API 更新须带之前读到的文件 SHA | 认证模块通过 Contents API 明确指定 `ref=auth-state` 读取并解密 |

仓库和分支是两个定位维度：`auth-state` 是分支名，`/codex.enc` 是该分支内的文件，不是默认分支的 `auth-state/codex.enc` 目录路径。launcher 不需要解密该文件；聊天进程不直接读它。

`codex.enc` 明文信封只保留格式版本、IV、密文和认证 tag；账号、凭据和阶段都在密文内。每次写入使用新 IV，认证上下文绑定执行仓库、共享账号标识和格式版本。

密文正文公共字段为 `generation`、递增 `revision`、`operationId`。`revision` 每次状态提交都递增，不代表 provider token 的版本。正文根据阶段只携带对应内容：

| 阶段 | 额外内容 | 含义 |
| --- | --- | --- |
| `ready` | 原生认证 JSON、账号 id、可验证的到期信息 | 可供认证模块提取 access token；完整 JSON 包含 refresh token |
| `refreshing` | 上一份原生认证 JSON、持锁 run / attempt / nonce | 已提交刷新意图；这份旧认证不能由其他进程再次拿去刷新 |
| `reauth_required` | 错误码 | 需要账号提供者重新授权；不把旧认证当成可用值 |
| `disabled` | 停用原因 | 停止共享；不携带可用凭据 |

仅 `ready` 可发放 access token。例如 `ready(revision=10)` → `refreshing(11)` → `ready(12)`。认证模块只有在最终 `ready(12)` 写入确认后，才能向聊天进程交付本次新 token。

首次初始化明确创建 `auth-state` 分支和认证文件；普通读取遇到 403、404、解密失败均报具体错误，不自动视为新账号，也不自动覆盖。部署 workflow 只匹配代码分支，认证分支和锁分支的更新不触发部署。

### 3.2 账号锁

| 对象 | 谁创建 | 谁读取 | 谁删除 |
| --- | --- | --- | --- |
| 锁说明 commit 内的 `/lock.json` | 正在竞争锁的认证模块；包含 run id、attempt、job id、随机 nonce，不含凭据 | 认证模块通过该 commit 读取持有者信息 | 不依赖删除 commit；它只是元数据 |
| `refs/heads/auth-lock-codex` | 认证模块使用 Create Reference API，指向自己的锁说明 commit；仅成功创建者持锁 | 其他认证模块 | 持有者核对 ref 仍指向自己的 commit 后删除 |

该 ref 是所有用户共享的 **Codex 认证锁**，与按用户分组的 runner concurrency 不同。只在读取 / 更新认证时短暂持有，不覆盖聊天时长。ref 已存在时等待；403 或其他校验错误不能一律解释为“有人持锁”。

不按时间强抢锁。遗留锁只在确认对应 job 已彻底结束后处理：共享文件已是 `ready` 时可清理遗留锁；仍是 `refreshing` 时按结果不确定处理，不能用旧 refresh token 自动再刷一次。[Git refs API][git-refs]

### 3.3 其他 GitHub 状态

| 对象 | 写入者 | 读取者 | 规则 |
| --- | --- | --- | --- |
| 每次运行的 Issue comments | launcher 和运行主进程 | 本次双方 | 敏感消息使用接收者公钥加密；校验 run、actor、request id、类型和有效期，拒绝重放 |
| `history-v1-<userId>-<agent>-<generation>-<runId>` cache | 本人归档模块 / 保存步骤 | 本人后续运行 | 只含密文 `state.enc`；不能恢复或清理全局前缀 |
| workflow inputs | launcher | workflow / 运行主进程 | 仅操作模式、Agent、request id、本次公钥、历史 generation；无凭据明文 |
| run-name | workflow | launcher | `shared-morty-<github.actor_id>-<requestId>` |
| concurrency group | workflow | GitHub Actions | `shared-morty-${{ github.actor_id }}`；登录、Claude、Codex 共用，`cancel-in-progress: false` |

所有文件访问的 userId 来自已认证 GitHub actor 的稳定数字 id，不能由浏览器输入任意覆盖。页面核对 actor 和 workflow 后只操作自己的运行；不同用户互不阻塞。重复点击由 concurrency 兜底，不取消正在运行和保存的环境，也不承诺公平队列。[GitHub concurrency][concurrency]

成员 PAT 留在浏览器，授予目标执行仓库的 Actions / Issues 所需权限。发布 Secret 的账号提供者另外需要 Secrets 写权限。Codex 认证任务使用 job 的 `GITHUB_TOKEN` 和 `contents: write` 更新文件 / ref，不使用成员 PAT，也不需要给 job 一个能修改 Secrets 的长期 token。[Secrets API][secrets]、[Contents API][contents]

## 4. Runner 上的具体文件

固定个人根目录：`U=/home/runner/shared-morty-user`，每个 job 的 VM 独立，因此不同用户可以使用相同内部路径。临时控制目录：`T=$RUNNER_TEMP/shared-morty`。这两个根目录均为拟定实现路径，不能混打包。

### 4.1 Codex 认证文件：必须与聊天目录分开

| 文件 | 内容 | 谁创建 / 写入 | 谁读取 | 何时删除 / 是否归档 |
| --- | --- | --- | --- | --- |
| `T/auth-refresh/<operationId>/codex/config.toml` | 指定 `cli_auth_credentials_store = "file"` 的最小配置 | 认证模块 | 临时 managed-auth app-server | 认证进程退出后清理；不归档 |
| **`T/auth-refresh/<operationId>/codex/auth.json`** | **当前完整原生认证，刷新后变为新认证** | **认证模块先写当前输入；managed-auth app-server 随后自行更新** | **managed-auth app-server；退出后认证模块读最终文件** | **新状态提交确认后清理；失败重试期间暂留；不进入个人归档 / cache** |
| `T/auth-refresh/<operationId>/publish.enc` | 准备提交的最终认证密文 | 认证模块 | 同一认证模块的 GitHub 写入代码 | 提交确认后清理；网络不确定时用于重试同一份提交 |
| `U/.codex/auth.json` | 不作为共享认证存放位置；固定版本若生成外部模式缓存，只允许无 refresh token 的内容 | 仅可能由个人 app-server 自行产生 | 个人 app-server | 启动时移除旧认证残留；保存个人历史时始终排除 |

临时 managed-auth app-server 使用独立 `CODEX_HOME=T/auth-refresh/<operationId>/codex`，并隔离 HOME / XDG；不能继承个人的配置、MCP 或历史目录。其 stdout 是认证协议，不写入 Actions 日志。

个人聊天 app-server 使用 `CODEX_HOME=U/.codex`，在任何模型请求前完成 external-auth 初始化。它的文件、内存和子进程不应得到 refresh token；refresh 回调交给认证模块。不得因适配不支持而回退到复制完整 `auth.json`。

实测补充：在本次固定的 Codex `0.154.0` 中，external-auth 初始化和一次 401 恢复后均未生成个人 `auth.json`；managed-auth 则确实更新了其独立目录中的认证文件。该观测不替代其他版本的归档排除规则，实验范围见 §9。

### 4.2 个人文件和归档

| 文件 / 目录 | 谁写入 | 谁读取 | 持久化规则 |
| --- | --- | --- | --- |
| `U/.claude/`、`U/.claude.json` | Claude Code / SDK | Claude、Morty、归档模块 | 个人历史范围；按锁定版本排除认证文件 |
| `U/.codex/` 中的 sessions、memory、索引、配置等 | 个人 Codex app-server | 同一用户的 Codex、Morty、归档模块 | 个人历史范围；排除 auth 文件和凭据缓存 |
| `U/workspace/` | 个人 Agent 和工具 | 个人 Agent、Morty、归档模块 | 文件、附件、产物随个人数据加密 |
| `U/morty/` | 本人的 Morty daemon / setup | 同一 daemon / adapter、归档模块 | computer 身份和私有凭据随个人数据加密；不属于共享账号 |
| `U/session.json` | 运行主进程 | 运行主进程、归档模块 | 当前会话定位、Agent 等恢复信息，随个人数据加密；不放共享模型凭据 |
| `T/history.key` | 运行主进程解开本次密钥信封后写入，owner-only 权限 | 归档模块 | 不归档，job 销毁时丢弃 |
| `T/history-cache/state.enc` | 归档模块 | 恢复 / cache 保存步骤 | 唯一进入个人 Actions cache 的状态文件 |

明确设置个人 `HOME=U`、`CLAUDE_CONFIG_DIR=U/.claude`、聊天 `CODEX_HOME=U/.codex`、`MORTY_STATE_DIRECTORY=U/morty`。恢复时归档模块写回上述个人目录，随后才启动 Agent / Morty；保存时顺序相反。

归档清单只包含这些个人目录 / 文件，不包含整个 HOME、临时认证目录、GitHub token、共享加密 key、npm cache、调试日志或 `T/history.key`。归档先验证 AEAD，再限制路径、符号链接和解压大小，禁止越出 `U`。

## 5. 内存、环境变量与浏览器状态

### 5.1 进程中的秘密

| 秘密 | 谁提供 | 谁持有 / 读取 | 会不会写个人归档 |
| --- | --- | --- | --- |
| `SHARED_CLAUDE_TOKEN` | GitHub Secret | 运行主进程只传给必要的 Claude / Morty 启动进程 | 不主动保存；用户自己粘贴进消息的内容仍属个人历史 |
| `SHARED_AUTH_KEY` | GitHub Secret | 认证模块，加解密共享 `codex.enc` | 不会 |
| Codex refresh token | 认证模块在锁内解密当前认证 | 认证模块、临时 managed-auth 进程 | 不会 |
| Codex access token | 认证模块 | adapter、个人聊天 app-server 内存 | 不主动保存；认证文件始终排除 |
| GitHub job token / cache 授权 | GitHub Actions | 运行主进程的 GitHub / 归档代码 | 不会 |
| `historyKey` | 本人 launcher 加密传来 | 运行主进程、归档模块及 `T/history.key` | 不会；它用于加密归档本身 |

启动聊天子进程时按明确清单构造环境，不直接展开含 GitHub 授权和共享 key 的整个父进程环境。此处定义的是正常数据流；同 UID 代码仍可能读取其他进程环境 / 文件，首版信任执行代码和平台，不宣称具有进程间秘密隔离。

### 5.2 浏览器持久状态

| 存储 | 谁写入 | 谁读取 | 内容与后果 |
| --- | --- | --- | --- |
| launcher IndexedDB vault | launcher | 本人 launcher | 不可导出的本地 AES key；加密的个人 PAT、按仓库 / 数字 userId / Agent 分区的 historyKey 和 generation；待发布的 Claude token |
| launcher 内存 | launcher / WebCrypto | 当前页面 | 解开的密钥、本次 RSA 私钥、授权交互和 Morty continue link；刷新会丢握手私钥 |
| Morty localStorage | 上游 Morty web | 同一 origin 的 Morty web | 上游设备访问凭据和偏好；不是 launcher vault 的一部分 |
| Morty sessionStorage / 内存 | 上游 Morty web | 同一页面 / origin | 草稿、待发送消息、当前聊天等；不能声称已被 launcher 加密 |

launcher 验证 PAT 对应身份后才选择 vault。不同人使用各自浏览器 profile。清理网站数据会丢 historyKey；仅重新登录 GitHub不能恢复，首版没有下载恢复包或跨设备同步。同源脚本可以调用不可导出 key 解密，因此必须信任页面发布者。

## 6. 四条读写流程

### 6.1 首次共享 Claude

1. 账号提供者的 launcher 启动自己的登录 job；不恢复个人历史。
2. 官方 `claude setup-token` 登录进程产生长期 token，运行主进程加密传回该 launcher。
3. launcher 使用仓库 Secrets 公钥封装后写 `SHARED_CLAUDE_TOKEN`；确认成功才显示“已共享”。
4. 后续 job 由 GitHub 注入该 token。此 CI token 与交互式登录的可刷新 credentials 区分，正常运行不回写 Secret；失效后由提供者重新授权。[Claude 官方说明][claude]

### 6.2 首次共享 Codex

1. 提供者的 launcher 仅在首次设置时生成 `SHARED_AUTH_KEY` 并写 Secret，再 dispatch 登录 job，使 job 启动时能取得它。重新登录不覆盖该 key。
2. 认证模块获取账号锁，在全新临时目录启动 managed-auth app-server，由提供者完成官方 device-auth。
3. **managed-auth app-server 写出临时 `auth.json`**；认证模块等待登录完成并停止该进程，读取最终文件、校验账号和字段。
4. **认证模块将完整认证加密，写 `auth-state` 分支的 `/codex.enc` 为 `ready`**，确认 GitHub 提交成功。
5. 认证模块删除临时文件并释放锁，运行主进程回报共享成功。其他成员无需再授权，提供者可离线。

### 6.3 用户启动聊天

1. launcher 以自己的 PAT 和数字 userId 检查本人运行；已有任务就返回原环境，不 dispatch 第二个。
2. 运行主进程创建本次 Issue / 公钥，launcher 核对真实 run 绑定，将个人 historyKey 加密给它。
3. 归档模块读取本人缓存的 `state.enc`，解密恢复到 `U`。错 key / 损坏会停止恢复，不能保存空历史覆盖。
4. Claude 直接取得 CI token。Codex 认证模块获取账号锁，读取并解密共享 `codex.enc`：`ready` 且 token 可用则取 access token 后释放锁；需要续期则执行下一节。
5. adapter 初始化个人 Codex app-server 的外部 token 模式；个人 `CODEX_HOME` 中不放完整共享认证。运行主进程启动本人 Morty，continue link 仅加密返回本人 launcher。
6. 聊天期间，Agent / Morty 写个人文件；共享认证只由认证模块在账号锁内改写。

### 6.4 Codex 自动刷新：每一步写到哪里

触发条件是 token 临近到期，或个人 app-server 发出 `account/chatgptAuthTokens/refresh`。到期时间按固定版本支持的字段解析；无法可靠确定时走认证回调，不能凭猜测认定有效。

| 顺序 | 执行者 | 读取 | 写入 / 动作 | 成功条件 |
| --- | --- | --- | --- | --- |
| 1 | 认证模块 | GitHub 锁 ref | 创建自己的锁说明 commit 和唯一 ref | 成功创建 ref 才持锁；等待有截止时间 |
| 2 | 认证模块 | `auth-state` 的 `/codex.enc` 和文件 SHA | 在内存解密、校验阶段 / 账号 / revision | 若其他人已换新 token，直接复用并释放锁，不再刷新 |
| 3 | 认证模块 | 当前 `ready` 正文 | 加密写回 **`refreshing`** 阶段，带本次 operationId / 锁持有者 | 使用预期 SHA 更新成功并确认；此步骤在调用 provider 前完成 |
| 4 | 认证模块 | 当前完整原生认证 | 创建临时配置，将认证写入 **`T/auth-refresh/<operationId>/codex/auth.json`** | 完整 JSON、owner-only 文件权限，临时 CODEX_HOME 独立 |
| 5 | **managed-auth app-server** | **临时 `auth.json`** | 调用 `account/read { refreshToken: true }`，由 Codex 刷新并**更新同一临时文件** | 协议成功响应；此进程不运行用户聊天 |
| 6 | 认证模块 | 临时进程最终写出的 `auth.json` | 停止并等待该进程退出后读取；校验仍是原账号，生成 `publish.enc` | 得到完整的新认证，而不是读取启动时的旧内存副本 |
| 7 | **认证模块** | **`publish.enc` 和步骤 3 的文件 SHA** | **Contents API 写回 `auth-state` 的 `/codex.enc` 为新 `ready`** | **提交确认；网络不确定时读回核对 operationId / revision** |
| 8 | 认证模块 / adapter | 已确认提交的新认证 | 清理临时目录、释放账号锁；把新 access token 返回个人 app-server | 只在步骤 7 成功后交付新 token；不把 refresh token 交给聊天进程 |

**第 5 步写本地文件的是官方 managed-auth app-server；第 7 步写 GitHub 持久文件的是我们的认证模块。两次写入必须都完成。** 只完成第 5 步就重启 runner，会丢失可能已经轮换的 refresh token；下一台机器也仍读到旧状态。

刷新时没有第二台认证 runner。正在持锁的那个用户 job 临时启动 managed-auth 子进程；其他用户继续用已有 access token 聊天，需要新 token 时等待或读取其提交的新版本。个人 app-server 自始至终使用 external auth。

官方 external-auth refresh 回调有约十秒超时。认证模块应尽量提前续期；来不及时让本次认证请求明确失败，保留个人历史，后台完成同步后提示重试当前 turn。不能自动重放可能已执行工具的整个 turn。[app-server 认证协议][codex-app-server]

## 7. 退出、失败与停止共享

### 7.1 正常退出的写入顺序

运行主进程停止接收新消息，等待或有界停止 Agent / Morty，以及进行中的认证操作；若认证操作仍存活，先完成共享认证提交 / 结果判定。归档模块随后读取静止的个人目录，用 historyKey 写 `T/history-cache/state.enc`，保存新 cache，成功后才清理本人旧 cache，最后关闭 Issue。保留最近两份成功个人存档。

**共享认证在每次刷新时立即提交；个人历史在正常保存时提交，两者没有“等待一起打包”的关系。** 个人归档不会写 `codex.enc`，刷新也不会改个人 cache。

### 7.2 中间失败留下什么

| 中断点 / 错误 | 持久状态 | 处理者和下一步 |
| --- | --- | --- |
| 取得账号锁前失败 | 当前共享认证不变 | 认证模块有界重试；不凭旧内存自行刷新 |
| 标记 `refreshing` 前失败 | 仍是上一份 `ready` | 释放本人锁，下一次重新读取 |
| 已标记 `refreshing`，provider 结果不确定 | 共享文件仍是 `refreshing` | 当前进程先判定结果；若 job 已丢失，不自动再次使用旧 refresh token，必要时提供者重登 |
| 本地新 auth 文件存在，上传暂时失败 | 新结果留在本次临时目录，远端仍可能是 `refreshing` | 同一认证模块持锁重试**保存同一结果**；不重做刷新，不提前清文件 |
| GitHub 提交响应丢失 | 可能已经是新 `ready` | 读回，核对 operationId / revision；已提交就继续清理，未提交则重试同一密文 |
| 新 `ready` 提交后 job 丢失 | GitHub 已有最新认证，可能遗留锁 | 确认旧 job 结束后清锁；下一 runner 可恢复最新值，不需重新授权 |
| provider 明确拒绝刷新 | `reauth_required` | 持锁认证模块写入原因；仅账号提供者重新登录 |
| history cache 保存失败 / 强制取消 | 个人最后成功 cache 保留 | 不显示保存成功；最新未保存聊天可能丢失，共享认证按其独立提交结果判断 |
| 个人 cache 被淘汰 | 个人密文缺失，共享认证仍独立存在 | launcher 显示数据缺失，用户明确选择重新开始 |

GitHub 文件写入、锁和 OAuth 刷新不是一个事务，无法保证“provider 已换 token，但整个 job 在提交前死亡”时自动恢复。不能用 `always()` 或“重启就好”掩盖这个窗口。

### 7.3 重新登录和停用的写入者

重新登录由账号提供者发起，仍由认证模块持同一个账号锁：managed-auth 进程写新的临时认证，认证模块发布新 generation 的 `ready` 文件；其他用户下次取 token 跟进。不得从旧个人 cache 恢复或回写共享认证。

Claude 停用由提供者的 launcher 删除 token Secret。Codex 停用先通过认证模块持锁写 `/codex.enc` 为 `disabled`，确认后由提供者的 launcher 删除 `SHARED_AUTH_KEY`，再停止该账号的活跃任务。已交付的 token 还需在 provider 侧撤销 / 轮换才彻底失效；首版不做逐成员授权管理。

## 8. 边界、依据和验收

- Claude 采用官方 CI 长期 token；Codex 不改成 API 计费，也不要求每个成员再授权。
- 官方 Codex managed-auth CI 模式要求保存更新后的文件，且避免多台机器并发刷新。本设计通过只让持锁的临时进程使用 managed auth、个人聊天走 external auth 来组合；这是待实现和验证的集成，不是官方已保证可用的多人 Action。[官方 CI 指南][codex-ci]
- Morty 当前通过 app-server 运行 Codex，需增加外部 token 初始化和回调处理；固定版本不支持时明确失败，不能偷偷回退到共享原生 auth 文件。[Morty adapter][morty-codex]
- 账号提供者和其他成员没有本人 historyKey，但持仓库写权限者可以修改下一次执行代码；首版信任发布者和运行平台。
- Morty relay 不是端到端加密；Morty 浏览器也保留原生状态。这里保证 GitHub 个人存档独立加密，不承诺运行基础设施不可读。[Morty 数据说明][morty]
- Actions cache 可能淘汰，个人连续会话是尽力保存；共享认证不存 cache，不受个人 cache 淘汰影响。[缓存规则][cache]

验收按文件检查：初次授权只发生一次；个人聊天 home 无共享 refresh token；两个用户同时到期只产生一条刷新流；临时 `auth.json` 更新后能在远端读到同一份新认证；第 7 步提交前不交付新 token；重启读取远端最新版本；每个失败窗口有上述可见结果；个人存档不含共享认证、共享 key 或历史 key。另验证不同用户并行、同用户跨 Agent / 登录最多一台运行中的 runner。

产品级读写者和 Morty 适配尚未完成；下面的真实 Actions 实验已经验证部分平台机制和官方二进制行为，未验证真实账号刷新。

## 9. 真实 GitHub Actions 实验记录

2026-11-13，在当前公开仓库 `taowen-paraflow/shared-morty` 的独立分支 `codex/workflow-state-experiments` 执行，未改动默认分支、真实凭据或 GitHub 设置。实验只使用合成 token / key；该批实验未使用真实凭据；后续正式设计允许公开仓库执行，依赖 Secrets、加密和可信默认分支。

最终版本 `1ce41065fd94c8bdec8dff1b7e70f4d47f0b877d` 的 [完整运行](https://github.com/taowen-paraflow/shared-morty/actions/runs/43332500847) **17 个 job 全部成功**。其中 `crash-after-intent` 内部故意让测试进程退出 23，workflow 检查该失败确实发生，再继续验证恢复；该预期失败没有被当作普通成功忽略。

复现入口：[workflow](./.github/workflows/state-experiment.yml)、[GitHub 状态实验](./experiments/github-state.mjs)、[真实 Codex 二进制实验](./experiments/codex-auth.mjs)。[机器可读结果](./experiments/results.json) 包含全部 job id、观察值及之前的运行记录。可在该次 Actions 页面选择重新运行；每次 attempt 使用独立的测试分支 / ref / cache 前缀。

| 对应设计 | 实际执行 | 观察结果 | 证明范围 |
| --- | --- | --- | --- |
| §3.1 job token 写共享认证 | 真实 `GITHUB_TOKEN`，job 显式授予 contents write，创建测试状态分支并读写 AES-GCM 密文 | 成功，无需 Secrets 写权限或长期管理员 PAT | 证明当前仓库中的 Contents / Git API 权限路径；未验证 Secrets 的首次配置和注入 |
| §3.2 跨 VM 账号锁 | 三个独立 matrix job 竞争同一个 ref；赢家延长临界区，其余轮询 | 仅一个 job 提交模拟新 token，另外两个持锁后读到新版本并复用 | 真实 GitHub 互斥与重新读取；刷新结果本身是合成值 |
| §3.1 防止旧值覆盖 | 新版本提交后，故意带旧文件 SHA 再写一次 | GitHub 返回 **409**，旧认证未覆盖新状态 | 真实 Contents API 的版本检查；不能因此省略刷新前加锁 |
| §6.4 写回确认 | 丢弃成功写入调用的返回结果，重新从 API 读回 operationId / revision；下一 job 再读 | 同一新版本在另一台 VM 可见 | 验证读回判定；没有注入真实网络断包 |
| §6.4 managed-auth 本地写入 | 官方 Codex `0.154.0` 连接本地 OAuth fixture；执行 `account/read { refreshToken: true }` 后退出 | 刷新端点调用 **1 次**，新的 access / refresh token 都留在退出后的 `auth.json` | 官方二进制和真实文件写入；OAuth 服务是本地替身，未调用真实账号 |
| §6.4 external-auth 回调 | 真实 Codex external-auth 向本地模型 fixture 请求，先收到 401；host 回调返回新 access token | 回调 **1 次**，模型请求 **2 次**，第二次携带新 token；没有调用 managed refresh 端点，也未生成个人 auth 文件 | 验证回调与原请求重试。第二次请求故意返回 400 结束测试，没有生成真实模型回复 |
| §7.2 刷新阶段崩溃 | job 内进程写 `refreshing` 后真实异常退出，留下锁；另一个 job 查询旧 job 完成状态再恢复 | 后续 VM 读到遗留锁和 `refreshing`，转为 `reauth_required`，没有重复刷新 | 真实进程退出和跨 job 持久化；未模拟 provider 已旋转 token 的外部副作用 |
| §3.3 用户运行分组 | 两个 job 使用当前 actor 的相同 group，第三个使用模拟另一用户的 group；记录实际临界区时间 | 同 group 两段执行时间不重叠，不同 group 存在重叠 | 只有一个真实 GitHub 账号；第二用户是模拟 group key，且本次测的是 job 级 concurrency，未实测两个账号或跨 workflow 的生产配置 |
| §4.2 个人 cache | Alice / Bob 合成密文分别保存；后续独立 VM 恢复，验证 owner 与错 key 拒绝 | 两份 cache 均恢复正确，错 key 解密失败，cache 文件无合成历史明文 | 真实 Actions cache 往返；key 是公开合成 fixture，不证明浏览器密钥保管或实际团队隔离 |

有两轮扩展测试失败，原因保留在 [第二轮](https://github.com/taowen-paraflow/shared-morty/actions/runs/43332045810) 和 [第三轮](https://github.com/taowen-paraflow/shared-morty/actions/runs/43332298000)：只设置 `chatgpt_base_url` 未改变默认模型请求地址，合成 token 被默认服务拒绝，故无法观察本地 fixture 的请求顺序。最终实验明确配置本地 model provider，并通过 Linux network namespace 只开放 loopback，随后通过。此前失败不能算作模型账号刷新失败，也不能称为全程本地实验。

测试状态分支和锁 ref 已由 cleanup 删除，实验代码分支和运行记录保留。测试 cache / 日志 / artifact 保留合成数据，按平台保留策略清理；未触碰生产命名的认证文件和 cache。

仍需验证：真实账号一次授权后的长期续期与共享 access token 接受情况；Morty adapter 集成；external-auth 回调超时及提前续期策略；真实 Secrets 注入与浏览器握手；跨 workflow 和两个真实用户的并发约束。这些结果不应由本地 OAuth fixture 或模拟用户名代替。

[secrets]: https://docs.github.com/en/rest/actions/secrets#create-or-update-a-repository-secret
[contents]: https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents
[git-refs]: https://docs.github.com/en/rest/git/refs#create-a-reference
[concurrency]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
[claude]: https://code.claude.com/docs/en/authentication
[codex-ci]: https://learn.chatgpt.com/docs/auth/ci-cd-auth
[codex-app-server]: https://learn.chatgpt.com/docs/app-server
[morty-codex]: https://github.com/moxt-ai/morty/blob/3d138038c76880c550a17170f99fddc8b3f0cfec/packages/cli/src/engine/acp/harness/codex/agent.ts
[morty]: https://github.com/moxt-ai/morty/blob/3d138038c76880c550a17170f99fddc8b3f0cfec/README.md
[cache]: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
