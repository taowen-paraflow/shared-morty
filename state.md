---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty 状态与文件读写约定

设计与实现状态，2026-11-13；Claude 登录、共享写入和临时个人 Claude / Morty 聊天已实现；个人归档尚未实现。本文按“谁持有状态、谁读、谁写、何时提交”组织。用户操作见 [user-journey.md](./user-journey.md)。

页面按“使用团队账号”“共享 Claude Code”分开，公共连接只核实 GitHub 身份及仓库，不查询 Secrets 或启动任务。功能状态由各页持有，不再使用跨功能的 action union / reducer。连接时默认进入使用页查询本人任务。

当前已实现运行控制：launcher 查询本人任务、向默认分支的 `runner.yml` 提交环境检查、自动更新状态、重新核验归属后请求停止本人任务。检查任务使用真实 actor id 的 concurrency group，验证默认分支、run 的 actor / event / workflow / request id，只报告共享 Secret 是否存在后退出，不启动 Agent 或 Morty。

Claude 登录使用独立 `login.yml`，与 `runner.yml` 共用 `shared-morty-${{ github.actor_id }}` concurrency group。浏览器创建本人 Issue 和临时公钥，runner 校验真实 run、actor、默认分支、run attempt、Issue 创建者与 request id 后，在隔离 home 中启动固定版本 `claude setup-token`。授权链接、授权码和结果 token 经 Issue 密文交换；浏览器收到 token 后单独点击共享，使用仓库公钥的 LibSodium sealed box 写 `SHARED_CLAUDE_TOKEN`。正常完成后关闭 Issue；关闭失败不改写授权结果。账号使用通过独立的 `chat.yml`，不进入此登录流程。

公开性不是授权边界：只执行可信默认分支，核对 actor / workflow / run attempt。外部读者可读取 Issue 和日志，所以授权链接、授权码、token 仍须加密交换，Secret 不进源码，个人 cache 只含密文；具有发布执行代码权限的人仍属于既有信任边界。

当前实现涉及的状态与读写者：

| 状态 / 文件 | 谁写 | 谁读 | 生命周期 |
| --- | --- | --- | --- |
| 浏览器连接状态与 Session：PAT HTTP client、规范仓库名、GitHub 身份、连接代号 | `connection.ts` 的 `useConnection`；身份与仓库经 GitHub schema 校验 | 页面连接摘要；两个独立功能读取当前 Session | 内存；输入框立即清空。重连取消旧请求并卸载旧功能；连接代号只用于本地组件生命周期，不作为身份依据 |
| 连接引导中的仓库名称及 Token 创建链接 | 部署者修改 `launcher/config.ts` 的 defaultRepository；本人在 `ConnectionForm` 修改仓库；`token-guide.ts` 规范化后派生链接 | 本人浏览器、GitHub 官方 Token 表单 | 只含公开仓库名及权限模板；默认协作者 classic 链接不含 target_name、预选 repo scope（不限单仓库），期限由本人设置；所有者 / 组织内部成员可选 fine-grained 链接，Actions / Issues write、90 天，共享另含 Secrets write。真实 Token 不写入链接或 React state；此预设不是执行授权依据 |
| 当前入口：使用 / 共享 Claude | `view.tsx` 的 Workspace，由本人导航操作更新 | 导航与对应页面 | 默认使用入口；切换不提交 workflow、不发布凭据；重新连接重置 |
| 使用页统一生命周期：loading / available / chat / syncing / working / offline / failed | `use-environment.ts` 串行调用领域操作，`usage-page.tsx` 只传递状态和事件 | `EnvironmentPanel`；诊断放入折叠的运行详情 | 启动和停止每 5 秒、就绪或空闲每 30 秒查询；暂时失败每 15 秒重试。每次查询结束后再计时，不重叠；用户操作取消旧查询，销毁取消计时和请求 |
| 浏览器聊天领域状态：waiting（queued / preparing）/ ready / stopping / stopped / failed | `launcher/personal-chat.ts` 解析和核验消息；失败优先于停止、停止优先于就绪；还查询实际 Actions 完成结果，避免无 bot 消息时永久等待 | 统一环境控制器；不被共享账号页读取 | ready URL 仅在内存，查询失败撤下；刷新后使用下述恢复记录重新核验与解密，绝不从本地直接展示旧链接 |
| Claude 共享页：intro / login / working；login 内为授权协议阶段 | `claude-sharing-page.tsx` 调用登录领域函数写入 | `ClaudeLoginPanel` | 切换入口只隐藏，不卸载，保留授权上下文；失败保留可重试结果；共享或取消后返回本功能设置。使用页不读取此状态 |
| 浏览器各功能当前请求的 AbortController | 共享页由 `useTask` 持有，使用页由 `useEnvironment` 持有；连接请求由 `useConnection` 持有 | 对应 GitHub / 登录异步操作 | 同一功能同步阻止重复提交；卸载、重连、页面销毁时取消，已取消响应不能写回。切换入口不会取消保留中的 Claude 登录或个人聊天交换；不代表取消已提交的远端任务 |
| workflow dispatch inputs：检查任务的 `mode=check` / `request_id`；登录及聊天任务的 `issue` / `request_id` | launcher | GitHub、对应运行进程 | 不携带凭据、授权码或私钥；提交成功不等于任务已启动 |
| Actions `GITHUB_EVENT_PATH` 指向的事件 JSON | GitHub | 检查入口；登录 / 聊天通过 `issue-execution.ts` 的 `readIssueExecution` 读取 | 本次 job 临时文件；公共解析只返回 readonly IssueExecution，不授予执行权限；领域入口仍用 job token 核对真实 run |
| job 环境中的 `GH_TOKEN` | GitHub 注入 job token | 运行进程的 GitHub HTTP client | 检查任务 contents / actions read；登录、聊天任务另有 issues write。均不传给 Claude 子进程，不授予 Secrets 写入 |
| `SHARED_CLAUDE_AVAILABLE` | workflow 根据 Secret 是否为空计算字符串布尔值 | 检查进程 | 只传存在标记，不传 Secret 内容；不进行登录或认证有效性验证 |
| `SHARED_MORTY_DIAGNOSTICS=1` 的结构化诊断日志 | 登录进程 / HTTP client / PTY 适配器 | Actions 日志读者（公开仓库中包括任何人） | 仅固定事件、资源类别、状态码、长度、run / attempt / Issue id、聊天生命周期与白名单提示标记；没有原始 URL、输入、终端文本或 token |
| 检查 stdout 的 sanitized JSON / Actions 日志 | 检查进程 | 运行者通过 Actions 页面查看 | 含本人 id、request id、Secret 存在标记及旧字段 `chat=not_implemented`。该检查不作为整个产品能力判断；个人聊天独立运行 `chat.yml`，不含凭据或聊天 |
| 浏览器登录临时 RSA 私钥及未共享 Claude token | 本页生成私钥，解密 runner 的 token 消息 | 本页 launcher | 仅内存，私钥不可导出；共享完成、取消或页面销毁后放弃引用，不写浏览器持久存储 |
| 本次 Issue 正文 | launcher | 登录进程 | 协议 v1、本人 id、request id、浏览器公钥、15 分钟 expiresAt；不含凭据 |
| 本次 Issue comments | launcher 写授权码密文；job bot 写 challenge / token / error 密文 | 本次双方 | RSA-OAEP-SHA256 包装 AES-256-GCM key；AAD 绑定仓库、Issue、request、run、attempt、消息类型与期限。网页验证 bot 稳定 id，runner 验证真实用户 id；拒绝重复 code 和混合 attempt |
| 登录目录 `$RUNNER_TEMP/shared-morty-claude-login-<随机后缀>/` | 运行进程创建，Claude 写自己的临时配置 | 仅本次登录子进程 | 同时作为 cwd / HOME / USERPROFILE / TMPDIR / TEMP，不载入个人聊天；子进程退出后运行进程递归删除。VM 强制销毁时依赖平台清理 |
| PTY 和 xterm 内存屏幕 | 官方 Claude CLI 输出，运行进程读取 | 登录适配器 | `script` 日志目标为 `/dev/null`，stdout / stderr 不转发到 Actions 日志；等待授权码明文或“星号遮罩 + 末尾六字符”在屏幕确认后才发送 Enter；不按任意日志文本提取凭据 |
| 仓库 Secret `SHARED_CLAUDE_TOKEN` | 本人 launcher 在显式点击共享后通过 PUT 写入或替换 | 后续 Claude 任务由 GitHub 注入 | 传输使用 GitHub 公钥 sealed box；只有 HTTP 201 / 204 成功才显示共享成功，权限或网络失败保留本页 token 供重试 |

### 浏览器恢复存储（已实现）

这是浏览器同源存储，不增加服务端数据库或常驻服务。原生 IndexedDB 名称 `shared-morty-browser-v1`、版本 1、object store 为 `vault`，只有 `browser-vault.ts` 读写。文件由浏览器配置目录管理，本项目不指定磁盘路径。存储操作有 8 秒期限，失败阻止启动，避免创建无法恢复的任务。

| 存储 key / 值 | 谁写、何时写 | 谁读 | 清理与边界 |
| --- | --- | --- | --- |
| `connection-key`：不可导出的 AES-256-GCM CryptoKey | 首次成功连接时生成，单个 readwrite 事务防止并发覆盖 | `browser-vault.ts` 加解密连接 | 清除网站数据时删除；不是硬件绑定或独立密码保护 |
| `connection:<API origin>`：v1、IV、AES-GCM 密文 | `useConnection` 核验本人和仓库后保存 `{token,repository,userId}`；AAD 绑定 slot | 刷新时解密，重新请求 GitHub 身份和仓库，身份与保存值不符则拒绝 | 最近连接覆盖旧连接；输入框立即清空；过期 Token 必须重新连接。Token 不传给 runner 或 Morty |
| `chat:<规范仓库>:<GitHub user id>`：v1、phase、Issue、request、公钥及不可导出 RSA 私钥 | 创建 Issue 后、dispatch 前保存 phase=waiting；核验要停止的 run 后、发送停止指令前保存 phase=stopping | 使用页按远程已核验的本人身份读取；再核对 request owner、公钥、key 类型和 schema | 确认失败 / 停止 / 到期后删除；不保存 ready URL、聊天正文、共享 token 或历史归档 |

恢复顺序：连接密文 → GitHub 重新认证 → 查本人 checkpoint → 读 bot 密文并核验真实 workflow / run / attempt → 解密 → 确认 run 仍活跃、访问未到期 → 显示入口。停止中的 checkpoint 不会因旧 ready 消息重新变成就绪。查询失败隐藏旧入口并保留 checkpoint，自动重试时重新读取它；收到已结束任务也会撤下入口。清除网站数据、换浏览器或换 origin 后无法恢复旧密钥，可以从运行详情停止旧任务再重启。

非导出 CryptoKey 仍可被同源脚本使用；此存储不防同源 XSS、恶意部署代码或浏览器配置文件被接管。请使用自己的浏览器配置文件。Claude 登录交换的私钥和未共享 token **仍仅在内存**，不受聊天恢复机制覆盖。现有 Issue / runner 协议 v1 未改变；旧页面没有 checkpoint 的任务不能事后恢复遗失私钥。

### 当前个人聊天的文件与状态

`R = $RUNNER_TEMP/shared-morty-<真实 actor id>-chat-<随机后缀>/`。每个 job 使用自己的临时 R，不复用其他用户或上一次任务的 home。当前不保存任何个人 archive / cache；以下 R 是实际临时布局。

| 状态 / 文件 | 谁写 | 谁读 | 何时清理 / 提交 |
| --- | --- | --- | --- |
| 浏览器本次聊天的不可导出 RSA 私钥、公钥、Issue / request id | launcher 每次启动生成，`browser-vault.ts` 在 dispatch 前写入浏览器原生 IndexedDB | 同源 launcher 在远程核验 GitHub 身份后读取；公钥写入 Issue | 切换 / 刷新 / 重连同一身份可恢复；确认终态后删除 checkpoint；不与 Claude 登录页密钥或未来 historyKey 共用 |
| `shared-morty-chat-<requestId>` Issue 正文 | launcher | 运行主进程 | v1、purpose=claude_chat、真实本人 id、浏览器公钥、request id、1 小时 expiresAt；无凭据；正常结束时主进程关闭 Issue |
| 聊天 Issue 的 ready / error / stopped comments | 已核验 run 的 job bot | 本次 launcher | 使用现有 RSA-OAEP / AES-GCM 密文；AAD 另外绑定 purpose、仓库、Issue、request、run、attempt、期限。ready 内含 Morty 私人链接和访问到期时间；不写聊天正文 |
| 聊天 Issue 的 stop comment | 已登录的本人 launcher | 运行主进程每 30 秒查询 | 只有公开的停止意图和绑定字段，无秘密；主进程核对真实 comment author id / User 类型、request、run、attempt、expiresAt 后才接受。其他人的留言无效 |
| 主进程内存中的共享 token | GitHub 将 `SHARED_CLAUDE_TOKEN` 注入 chat 步骤，`chat.ts` 读取 | 仅必要的个人 Claude / Morty 子进程，通过 `CLAUDE_CODE_OAUTH_TOKEN` | 浏览器不接收 token；不写共享认证文件、不更新 Secret；退出时随 VM 释放 |
| `R/workspace/` 与其中本人创建的文件 | 本人的 Agent / 工具 | 同一 Agent、Morty、本人授权的操作 | 运行中的明文，其他用户在不同 VM；正常退出递归删除 R，强制结束由 VM 销毁清理；没有跨次恢复 |
| `R/.claude/`（含 projects 下 session JSONL）、`R/.claude.json` | 官方 Claude CLI 和 Morty 的 Claude harness | 本人的官方 CLI、Morty harness | 启动时创建一次带 UUID 的 seed session，随后 Morty 继续同一 session；不上传日志或 cache；随 R 删除 |
| `R/morty/` 下的 identity、daemon 配置和原生日志 | 固定版本 Morty CLI / daemon | 同一临时 Morty computer | `MORTY_STATE_DIRECTORY` 指定该目录；本项目不读取其凭据正文、不上传该目录；正常停止先调用 morty stop 再删除 R |
| 启动子进程 stdout / stderr 缓冲区 | 官方 CLI / Morty CLI | `personal-agent.ts` 经 schema 解析 | 有界缓冲和超时；不转发到 Actions 日志；错误保留内部 cause，用户只见稳定错误码的消息 |
| Morty 继续链接及浏览器原生设备访问状态 | Morty 服务返回 transfer；launcher 解密后提供链接；Morty 网页消费链接并写原生浏览器状态 | 本人浏览器、Morty / daemon | 链接只通过密文交付，限定 morty.build /continue、claude harness、UUID session；访问时长 1h；不要转发。Morty 原生浏览器数据不由 launcher 加密或管理 |

个人聊天的启动调用顺序为：重新确认本人空闲 → 创建聊天 Issue → 提交本地恢复 checkpoint → dispatch 默认分支 chat.yml → 校验真实执行上下文和 Issue 归属 → 建立 R → 启动官方 Claude seed session → `morty setup --harness claude --session-id … --device-access 1h` → 加密 ready → 持续等待本人 stop 或到期。请求起最多一小时（含排队），不是永久运行环境。Claude 和 Morty 固定为 2.1.323 / 0.4.253；子进程只继承 PATH、隔离目录、终端和运行标记、模型 token，不继承 GitHub PAT、job token 或无关 Secrets。

正常停止先发送本人 stop 指令，不取消 Actions job；主进程停止 Morty、发送加密 stopped、关闭 Issue、删除 R，然后自然退出。清理操作有各自时限，网络失败仍结束任务，不承诺关闭 Issue 一定成功。超时或异常也执行同一清理。GitHub 取消是强制兜底，可能来不及执行 finally；此时 VM 销毁保证不留运行环境，Issue 可能需要手工关闭，且没有保存历史。

Claude 登录协议维持原格式。聊天 v1 新增 stop 控制类型；原始 d86b7af 聊天 worker 不处理它，混用旧 worker 时需显式强制停止，不把“指令已发送”当作任务结束。所有可变 GitHub GET 禁用缓存并附单次随机查询参数，防止评论 / 任务接口的 max-age=60 或中间缓存隐藏新状态；随机参数不携带身份或密钥。

登录进程只传 PATH、临时 home 路径、终端类型、`BROWSER=false`、关闭更新与非必要流量的标记给 Claude；不传成员 PAT、job token、其他 Secrets 或个人密钥。90 秒内必须看到授权入口；整个交换期限从浏览器创建请求起算 15 分钟，包含排队。取消和超时会停止子进程，并有界尝试发送加密错误和关闭 Issue。取消 API 的成功仅表示请求被接收；页面仍需确认任务结束。请求或授权码发送结果不确定时保留本页上下文等待刷新，不自动重发。

当前验证包括真实 HTTP 替身、实际加密与 Secret 解密、外部进程替身，以及下面单独列出的官方固定版本真实运行。已在公开仓库完成真实浏览器到 runner 的 challenge / code 密文往返；首次真实授权因官方 CLI 遮罩输入与旧 fake 不同，在发送 Enter 前失败；合成探测定位后，修正后的真实运行 43358458456 成功确认遮罩输入、发送 Enter、返回 108 字符 token 密文并关闭 Issue。真实浏览器完成解密和 LibSodium Secret 发布，GitHub 元数据确认 `SHARED_CLAUDE_TOKEN` 于 2026-11-13 03:24:30 UTC 创建。另一台 VM 的运行 43359580808 读取新 Secret，官方 `claude auth status` 确认 `loggedIn=true` / `oauth_token`；该次未发起模型对话。后续运行 43366687430 使用同一共享 Secret，在新的隔离 VM 中执行官方 Claude Code 2.1.323 的单轮 Sonnet 请求，返回成功且合成答案校验通过；禁用工具和会话持久化，不输出对话内容。该实测证明共享凭据可用于模型推理，不代表网页 / Morty 聊天、个人历史隔离或多人并发已经实现。观察、修正和公开日志扫描结果见 `experiments/claude-live-results.json`。此前浏览器额外检查被拒绝不再代替这次实际观察；未完成的项目仍不记为通过。此协议是新增 v1，尚无已发布的旧消息对端；当时的检查 CLI 输出及保存格式未变；当前检查输出的范围收敛见下文。

页面尚不读取环境检查的完整输出，详情在 Actions 查看；Claude 登录状态从加密 Issue 消息读取。临时 Claude / Morty 聊天以本节实际读写为准。

## 范围与运行边界

当前只支持 Claude Code。系统由静态 launcher、GitHub Actions 和 Morty 组成，不增加服务端数据库、常驻后台、下载或导出功能。

共享认证只有仓库 Secret `SHARED_CLAUDE_TOKEN`。账号提供者通过官方 setup-token 授权一次，由浏览器显式发布；个人聊天 job 读取并注入 `CLAUDE_CODE_OAUTH_TOKEN`。聊天任务不改写 Secret，不持有原生登录刷新文件。凭据失效时由提供者重新授权和发布，不要求每位成员进行 Claude OAuth。

所有登录、聊天和环境检查任务共用 `shared-morty-${{ github.actor_id }}` concurrency group，`cancel-in-progress: false`。本人同时只有一个运行任务，不同用户可以并行。真实 GitHub actor id、workflow、默认分支、run / attempt 和 Issue 归属共同决定执行权限，不能仅凭调用者传入的名字或 id。

当前历史和文件只在本人 VM 内暂存；没有个人 archive / cache、历史密钥交付或跨次恢复。浏览器 vault 只恢复当前环境入口。正常结束停止进程、发布加密结果、关闭 Issue 并删除临时目录；强制取消可能跳过清理，最终依赖 VM 回收。

公开仓库的日志和 Issue 可被外部读者读取，所以秘密必须加密交换，日志只记录已净化元数据。运行期的 VM、Morty 和模型服务处理明文，不承诺这些基础设施不可读；有权修改可信执行代码的人属于信任边界。

环境检查 CLI 的 JSON 现在只报告 Claude 凭据存在情况，移除第二种 Agent 的配置字段。这是本次范围收敛的显式输出契约调整；当前 launcher 不消费检查 stdout，公共 CLI 验收已同步。Claude 登录 / 聊天 Issue 协议 v1 和浏览器 vault v1 不变，已有保存记录无需迁移。

## 当前个人 Claude / Morty 真实流程验证

2026-11-13，使用已共享 Secret，无重新授权或覆盖凭据。运行 [43369263594](https://github.com/taowen-paraflow/shared-morty/actions/runs/43369263594) 从真实浏览器启动并解密 Morty 链接，在 Morty 页面发送合成消息、批准一次终端操作、写入并读取测试文件，收到正确结果。该轮也暴露 GitHub 60 秒缓存及取消时来不及清理的问题；强制取消后遗留的 Issue 3 已手工关闭，不记作正常停止成功。

修正后的运行 [43370609941](https://github.com/taowen-paraflow/shared-morty/actions/runs/43370609941)（源码 6c9e6ab）再次完成浏览器交接与问答，确认新的工作目录没有上一轮文件。随后从 launcher 发送正常停止：workflow success、Issue 4 自动关闭、主进程记录 cleaned_up、launcher 显示没有运行任务、Morty 页面显示 Offline。公开日志和评论的 token / transfer code / 授权码 / PKCE / 合成聊天文本扫描均未命中；评论为两个密文结果加一个仅含公开绑定字段的本人 stop 指令。这是定向证据，不是保密性的通用证明。

[部署 43370576007](https://github.com/taowen-paraflow/shared-morty/actions/runs/43370576007) 已发布 [永久 launcher](https://taowen-paraflow.github.io/shared-morty/)，浏览器确认能加载，HTML / JS / CSS hash 与实测构建一致。真实认证流程使用同一构建的临时 localhost 页面和一次性本机 GitHub 连接 bootstrap；没有另行在公网表单填 PAT。仅使用一个真实 GitHub 成员顺序运行；未验证两名真实成员并发、历史持久化。机器可读记录见 [personal-chat-results.json](./experiments/personal-chat-results.json)。

2026-11-13 刷新恢复实测：[run 43376282942](https://github.com/taowen-paraflow/shared-morty/actions/runs/43376282942)，源码 4b75b48。真实 Chromium 自动显示就绪；整页刷新后 GitHub 自动重连、原生 CryptoKey 恢复，解密得到同一会话入口；在 Morty 收到合成消息的预期回复。正常停止后刷新确认终态，Actions success、Issue 6 自动关闭、cleaned_up、Morty Offline。公开日志和评论的凭据 / transfer / OAuth code / PKCE / 合成聊天文本定向扫描均未命中。另一真实 actor 的 run 43373788316 同时仍在运行，未被本次控制；这不代表已验证双方聊天数据隔离。认证测试用同一构建的 localhost 一次性 GitHub bootstrap；未测试浏览器进程重启、跨站点迁移、归档。记录见 `experiments/personal-chat-results.json` 的 refreshRecovery。

Token 引导修正：GitHub 官方当前不支持 repository / outside collaborator 使用 fine-grained Token。个人账号 taowen-paraflow 的仓库协作者 taowen 应用本人的 classic Token；不能将 taowen-paraflow 强行作为其 fine-grained Resource owner，也不共享所有者的 GitHub Token。taowen 的写权限已由真实 API 确认；真实聊天 run 43376282942 的 actor 也是 taowen。该证据来自现有 classic 凭据，不代表已经验证新 Token 的签发。引导测试只验证链接和可见说明，不模拟 GitHub 发证策略。[Token 限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)；[dispatch 的 classic repo scope 要求](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
