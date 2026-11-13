---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty 用户流程

设计与实现状态，2026-11-13。静态 launcher + GitHub Actions + Morty，不增加数据库、常驻后台、下载或导出功能。文件及读写者见 [state.md](./state.md)。

## 三个独立入口

连接 GitHub 后，用户按目的选择入口。共享是账号提供者的工作，使用是团队成员的工作；二者不会串成必经步骤。

| 入口 | 用户目的 | 当前能力 |
| --- | --- | --- |
| 使用团队账号 | 使用别人已提供的 Claude / Codex 账号，进入自己的对话环境 | 已实现临时个人 Claude / Morty 聊天、本人任务控制；Codex 聊天和历史恢复尚未实现 |
| 共享 Claude Code | 将自己的 Claude 账号提供给执行仓库成员 | 已实现官方授权、加密交换、显式发布 Secret |
| 共享 Codex | 将自己的 Codex 账号提供给执行仓库成员 | 独立说明页；授权、发布及刷新协调尚未实现 |

“使用团队账号”是默认入口。它不要求用户先共享账号，也不展示提供者的授权表单。环境检查只是诊断，不是聊天启动按钮。共享页只展示对应账号的授权和发布步骤，不混入环境检查。

## 公共准备：连接 GitHub

管理员部署 launcher，给可信执行仓库启用 Actions 和 Issues，并授予成员需要的权限。执行仓库可以公开；凭据不得进入源码、公开日志或 Issue 明文。具有修改执行代码权限的人属于信任边界。

页面首次展开三步连接引导：

1. 确认已预填的执行仓库；团队成员通常无需修改，fork 部署时管理员应配置自己的默认仓库。
2. 如果仓库属于别人的个人账号，点击“创建协作者 Token（classic）”，使用自己的 GitHub 账号，确认 repo scope、选择较短期限后生成 Token；无需 Resource owner。classic 的 repo 权限不能限定单个仓库，会覆盖本人有权访问的公开和私有仓库。本人仓库所有者或组织内部成员可展开对应入口，用 fine-grained Token，只选执行仓库和 Actions / Issues Read and write；共享账号另需 Secrets write。组织外部协作者不适用该 fine-grained 路径。
3. 复制 GitHub 刚生成的完整 Token，回到第 3 步粘贴并连接。已有 Token 可直接跳到输入框。

只使用团队账号的人不需要 Secrets 权限。fine-grained 路径的“我要共享自己的账号”展开后提供另一条额外申请 Secrets Read and write 的创建链接；它不启动 Claude 授权或自动共享账号。页面还提供资源所有者 / 仓库不可见、组织审批 Pending 和过期 Token 的排查提示。

页面通过 GitHub API 确认本人和目标仓库，成功后连接区收起并显示身份与仓库。Token 输入框立即清空，连接加密保存在此浏览器；刷新后自动重新核验 GitHub 身份并恢复连接。请使用自己的浏览器配置文件；清除此网站数据会丢失连接和环境恢复密钥。连接本身不会启动任务或读取 Secrets。

一般使用者不需要 Secrets 写入权限。Claude 账号提供者需要 Actions / Issues 读写及仓库 Secrets 读写权限。这里的 GitHub 身份连接与模型账号授权是两件事，不要求每位成员进行 Claude / Codex OAuth。

展开连接区可以重新连接；页面提前说明，重新连接会丢弃未共享的授权结果。重新连接或页面销毁会取消旧页面请求，但不等于停止已经提交到 GitHub 的任务。

## 共享 Claude Code：Alice 提供自己的账号

1. Alice 连接 GitHub，进入“共享 Claude Code”。页面说明这是提供自己的账号，须有 Secrets 权限；进入页面不会自动启动授权。
2. 点击“开始 Claude 授权”。系统重新核实本人没有运行任务，再在 Alice 的 runner 前缀下提交登录任务，不读取个人聊天历史。
3. 点击“刷新登录状态”，取得“打开 Claude 官方授权页面”。Alice 在官方页面登录，将授权码粘贴回此共享页并提交，然后刷新等待授权结果。授权链接、授权码、结果 token 通过 Issue 密文交换。
4. 页面显示“已登录，尚未共享”。此时尚未改写团队凭据。Alice 确认后点击“共享到此仓库”，写入或替换 `SHARED_CLAUDE_TOKEN`。
5. 只有 GitHub 确认写入成功，页面才显示“团队 Claude 已共享”。“返回共享设置”返回本功能的起点，不跳去运行环境。Alice 可以离线，Secret 已由仓库保管。

分享给整个执行仓库的运行成员，不选择接收者、不设置期限。共享模型账号不会共享 Alice 的个人会话、文件或 Morty 身份。Secrets 写入失败时保留本页授权结果，可以重试；重新授权本身不自动替换已有共享。

切换到使用页或 Codex 页不会丢弃未完成的 Claude 授权；返回 Claude 共享页可继续。其他页不展示 Claude 授权控件。刷新、关闭页面或更换连接会丢失临时私钥和未共享 token，无法恢复本次交换。交换有效期自发起起 15 分钟，包含排队。

共享前可“取消登录”：等待阶段只请求取消本次核验过的登录任务，拿到 token 后则放弃未共享结果。返回共享设置不会撤销已有 Secret；任务是否已结束可到使用页刷新确认。

本流程已在当前公开仓库完成真实授权和 Secrets 发布；另一个 runner 的官方 CLI 已识别注入的 token。后续真实 runner 已使用同一共享 Secret 完成一轮官方 Claude Code 模型问答，答案校验通过；其他成员角色及多人并发仍未验证。之后的个人聊天流程见下文；上述凭据探测本身不代表网页链路验证。未重新授权或改写共享 Secret。

## 共享 Codex：Alice 提供自己的账号

当前独立页面只说明尚未实现，不提供会被误认为可用的授权按钮。下面是待实现流程：

1. Alice 从“共享 Codex”发起首次设置，浏览器生成共享认证加密 key 并保存为 Secret，再在她本人的唯一 runner 中执行官方 device-auth。
2. 同一 runner 的 managed-auth 进程取得完整认证，由认证模块加密提交到执行仓库 `auth-state` 分支的 `codex.enc`。提交成功才显示共享成功。
3. Bob、Carol 从使用页启动各自的 Codex 环境，不再各自授权。聊天进程只接收 access token；完整认证和 refresh token 归账号认证模块管理。
4. 接近过期时，在现有 runner 内获取账号锁，启动短暂 managed-auth 进程刷新，再保存新的完整认证。只有提交确认后才发放新 token。正常续期不需要 Alice 在线。

官方外部 token 协议的适配和真实并发刷新验证仍待完成。不能直接把完整 `auth.json` 同时复制给所有聊天进程，也不能用逐成员授权替代这条流程。

## 使用团队账号：Bob 使用 Alice 已共享的账号

当前 Claude 流程：

1. Bob 连接 GitHub 后默认进入“使用团队账号”。个人环境卡片提供“开始聊天”，不需要进入共享页、Claude OAuth 或 Secrets 写入权限。
2. 点击后先显示提交，再显示等待运行 / 准备环境、已等待时间及“取消启动”。后台每 5 秒自动查询；准备超过 5 分钟给出查看运行详情或取消的提示，不显示虚构百分比。已有本人任务时不再提供启动，运行详情可以处理它。
3. runner 使用现有共享 token，在本人的全新目录创建 Claude 会话并连接 Morty。网页核验真实运行和密文后自动显示“环境已就绪”，主要操作是“打开聊天”。任务失败也会自动退出等待。
4. 点击“打开聊天”，在 Morty 网页发消息。工具操作可能需要在 Morty 确认；不要转发私人链接。就绪期间每 30 秒核验状态。
5. 刷新、关闭再返回同一浏览器同一站点，自动恢复连接与本人环境。启动中可继续等待，就绪可重新打开，停止中继续等结束；不会重复创建 runner。网络失败会撤下旧入口，15 秒后自动重试，也可“立即重试”。
6. “结束环境”是次级操作，先说明文件和历史不会保存，再点“确认结束”。运行进程最长每 30 秒读取正常停止指令，清理临时目录并关闭 Issue；网页自动确认结束。停止太久可以在“运行详情”强制结束，但可能跳过清理。

任务从发起起最多一小时（包括排队）。关闭网页不会停止任务。恢复能力只适用于本次运行的入口，不是历史持久化；清除网站数据、换浏览器或站点后，无法找回旧密钥，可在运行详情停止旧任务后重新开始。旧版本未保存 checkpoint 的已遗失入口不能补救。切换 GitHub 用户只恢复当前远程核验身份的环境，不撤销原本已打开的 Morty 访问。

当前每次启动都是全新环境，不恢复最近会话、不上传聊天 archive，不提供“保存并停止”。Morty 自身可能在本浏览器保留原生数据；launcher 不把这种浏览器缓存当成可恢复的个人存档。运行期的本人 VM、Morty 和模型服务处理明文，不承诺基础设施不可读。每人应使用自己的浏览器配置文件；切换 launcher 的 GitHub 连接不会撤销本浏览器已经获得的 Morty 访问。

折叠的“运行详情”中仍可单独“检查运行环境”，仅报告共享凭据是否存在，详情在 Actions 查看；它不启动 Agent / Morty，也不验证凭据可用性。其他入口不会出现本人的聊天控件。

待实现的连续会话：浏览器为本人持有独立 historyKey，将其加密交付给经过核验的个人 runner；只恢复本人的历史、文件与 Morty 身份。保存时先停止写入，再加密归档到本人 cache。没有恢复包、导出或跨设备迁移；清理浏览器数据会丢失旧历史的解密能力，解密失败不得以空历史覆盖旧归档。Codex 聊天还需完成独立的共享认证适配。

## 失效与停止共享

Claude CI token 失效或 Codex 无法自动刷新时，只提示账号提供者回到对应共享入口重新授权。正常刷新不应变成新成员的登录流程，个人历史也不随共享账号重登而重置。

目前停止共享需管理员在 GitHub 删除对应 Secret；未来 Codex 还须停用认证状态并停止相关活跃任务。收回已经注入 runner 的凭据须在模型服务方撤销或轮换，单独删除 Secret 无法做到。首版不提供逐成员撤销。

## 验收边界

自动集成验收覆盖独立入口、切换后继续 Claude 密文授权、取消后返回共享设置、共享失败重试、跨入口单 runner 限制，以及重新连接时旧响应不能覆盖新环境。外部替身并不证明真实 OAuth 或多人刷新行为。

完整产品还需验证：Alice 共享后离线，Bob / Carol 能并发聊天，各自只有一个 runner，历史互不读取或覆盖；同浏览器重启能继续；Codex 一次授权、自动刷新回写且不并发旋转同一 refresh token。未完成项不按已交付能力描述。


当前真实验证已完成两次本人 Claude / Morty 启动：网页发送消息、一次终端工具授权与文件读写、收到回复；修正后的任务正常停止、自动关闭 Issue，Morty 变为离线。正式入口为 [shared-morty](https://taowen-paraflow.github.io/shared-morty/)。页面加载及发布构建一致性已验证；认证后的完整流程使用相同构建的本地测试入口，不能因此声称已验证另一位成员或多人并发。详见 [实验记录](./experiments/personal-chat-results.json)。

2026-11-13 刷新恢复实测：[run 43376282942](https://github.com/taowen-paraflow/shared-morty/actions/runs/43376282942)，源码 4b75b48。真实 Chromium 自动显示就绪；整页刷新后 GitHub 自动重连、原生 CryptoKey 恢复，解密得到同一会话入口；在 Morty 收到合成消息的预期回复。正常停止后刷新确认终态，Actions success、Issue 6 自动关闭、cleaned_up、Morty Offline。公开日志和评论的凭据 / transfer / OAuth code / PKCE / 合成聊天文本定向扫描均未命中。另一真实 actor 的 run 43373788316 同时仍在运行，未被本次控制；这不代表已验证双方聊天数据隔离。认证测试用同一构建的 localhost 一次性 GitHub bootstrap；未测试浏览器进程重启、跨站点迁移、归档或 Codex。记录见 `experiments/personal-chat-results.json` 的 refreshRecovery。

Token 引导修正：GitHub 官方当前不支持 repository / outside collaborator 使用 fine-grained Token。个人账号 taowen-paraflow 的仓库协作者 taowen 应用本人的 classic Token；不能将 taowen-paraflow 强行作为其 fine-grained Resource owner，也不共享所有者的 GitHub Token。taowen 的写权限已由真实 API 确认；真实聊天 run 43376282942 的 actor 也是 taowen。该证据来自现有 classic 凭据，不代表已经验证新 Token 的签发。引导测试只验证链接和可见说明，不模拟 GitHub 发证策略。[Token 限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)；[dispatch 的 classic repo scope 要求](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
