---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty 用户流程

设计草案，2026-11-13。采用 GitHub Pages + Actions + Morty，不增加数据库或常驻后台服务；状态细节见 [state.md](./state.md)。以下登录共享和聊天流程尚未实现。

当前可用流程：打开 launcher → 输入执行仓库和 GitHub Token → 连接并确认本人任务 → 空闲时点击“检查运行环境” → 点击“刷新状态” → 从任务链接查看检查结果。检查会核验私有执行仓库、默认分支和本人身份，并报告共享 Secret 是否存在，然后退出；不会进入聊天。已有任务时可以刷新或点击“强制停止（不保存）”，请求发送后继续刷新确认。此按钮不执行个人历史保存。PAT 目前只保留在本页内存，页面刷新后重新输入。

## 1. 管理员配置一次

1. 部署静态 launcher，Pages Source 选择 GitHub Actions；真实账号任务使用可信私有执行仓库，启用 Issues。公开源码仓库不保存真实凭据。
2. 给团队成员运行 workflow 所需的仓库权限；负责共享账号的人另外具备写 GitHub Secrets 的权限。
3. 配置固定版本的 Agent 和 Morty；Codex 需包含外部 token 适配，不能直接使用未经适配的上游版本。将页面地址发给成员。团队共用一个 Claude 账号和一个 Codex 账号；首次先开通 Claude。

每个用户有自己的 runner 前缀，同一用户最多一个运行中的 runner，不同用户可以同时使用。不另做排队系统。

## 2. 每个人第一次打开

1. 打开 launcher，按页面提示创建仅针对这个仓库的 GitHub fine-grained PAT，粘贴连接。
2. 页面确认当前 GitHub 身份，将 PAT 加密保存在本浏览器。
3. 选择“团队 Claude”或“团队 Codex”。个人历史密钥首次使用时自动生成并保存在本浏览器，不需要另行注册数据身份。

账号提供者在执行共享时需要 PAT 的仓库 Secrets 写权限；一般使用者只需要启动、停止和消息通信所需权限。

页面提示：“请持续使用本浏览器；清理网站数据会丢失个人历史密钥。”没有下载恢复包、导出、设备管理或跨设备迁移步骤。不同人使用自己的浏览器 profile。

## 3. Alice 登录并共享 Claude

1. Alice 点击“登录并共享 → Claude”，页面在 Alice 自己的 runner 前缀下启动登录任务，不加载任何人的聊天历史。如果 Alice 已有聊天或登录任务，先返回该任务或停止后再开始。
2. 页面显示 Claude 官方授权入口；Alice 在官方页面登录和授权，出现授权码时回到 launcher 粘贴。
3. 登录成功后，凭据加密返回 Alice 的浏览器，页面显示“已登录，尚未共享”。
4. Alice 点击“共享到此仓库”，页面通过 GitHub Secrets API 保存共享登录态。成功后显示“团队 Claude 已共享”。
5. Alice 可以关闭页面。后续成员的 runner 从 GitHub Secret 获取登录态，不要求 Alice 在线。

这里分享给的是整个仓库的运行成员，不选择接收者、不设置期限。分享的只是模型账号；Alice 的会话、文件和 Morty 设备不共享。

如果没有写 Secrets 的权限或保存失败，页面保留登录结果以便重试，不显示“共享成功”。

## 4. Bob 使用 Alice 的账号聊天

1. Bob 在自己的浏览器连接 GitHub，选择“团队 Claude”，点击“开始”。不需要登录 Alice 的 Claude 账号。
2. 页面按 Bob 自己的 runner 前缀检查状态：没有任务就显示“启动中”；已有任务则显示“你已有运行中的环境”，可返回当前聊天、查看状态或停止，不再启动第二个 runner。Carol 是否正在使用不影响 Bob 启动。
3. runner 收到 Bob 加密传来的个人历史密钥，恢复 Bob 上次保存的状态。首次使用就从空历史开始。
4. runner 使用仓库的共享 Claude 登录态，启动 Bob 自己的 Agent 和 Morty computer。
5. Bob 点击“打开 Morty”，在 morty.build 中聊天。入口只属于 Bob 的执行环境，不要转发给同事。

Bob 能看到自己的最近会话和文件。Carol 可以同时使用同一模型账号，启动的是她自己的新 runner、自己的历史和自己的 Morty 身份。Bob 不能通过多开标签页或切换 Claude / Codex 获得第二个运行中的 runner。

Alice 提供模型账号，不因此得到 Bob 或 Carol 的历史密钥。运行期仍由个人 runner、Morty 和模型服务处理明文，不承诺这些基础设施不可读。

## 5. 离开与继续

1. Bob 回到 launcher 点击“保存并停止”。页面显示停止和保存进度。
2. runner 停止 Agent / Morty 写入，将 Bob 的个人状态加密存进自己的 cache，显示保存成功或失败。
3. Bob 下次用同一浏览器点击“开始”，恢复自己的会话、文件和 Morty 身份，无需重新登录共享模型账号。

只关闭 Morty 标签页不会立即停止 runner；它会继续运行，到空闲或时限时尝试保存退出。强制停止可能丢失本次未保存内容。

已有存档解密失败时，页面报错并保留旧存档，不自动保存空历史。缓存被 GitHub 淘汰时明确告知；首版不提供永久历史或备份保证。

## 6. Alice 一次登录，大家使用 Codex

1. Alice 点击“登录并共享 → Codex”。首次设置时，页面先生成共享认证加密 key 并保存到 GitHub Secret，然后启动 Alice 的登录 runner。
2. Alice 在 OpenAI 官方页面完成 device-auth。环境不支持时直接说明当前无法登录，不增加文件导入流程。
3. runner 将这份完整认证加密保存到私有执行仓库的认证状态分支。提交成功后显示“团队 Codex 已共享”，Alice 可以关闭页面。
4. Bob、Carol 在各自页面选择“团队 Codex”，直接启动个人环境。**不要求每个人再授权一次。** 两人的会话、文件、Morty 身份和历史密钥仍然独立。
5. 聊天进程只使用当前 access token；接近过期时，已有 runner 内的认证模块自动协调刷新并保存新版本。Bob 和 Carol 的聊天可并行，仅很短的账号认证更新需要等待。
6. 正常续期不提示重新登录，也不需要 Alice 在线。只有认证确实被撤销、无法刷新，或异常中断导致最新认证无法恢复时，才提示“请账号提供者重新登录”。

页面可在续期时显示“正在更新账号登录态”。认证暂时超时则保留个人历史，提示稍后重试当前消息，不把轮换处理变成新成员的授权流程。

上述模式需要接入官方实验性的外部 token 协议，完成真实并发刷新验证后启用。不能退回为把同一份完整 `auth.json` 复制给所有聊天进程，也不能偷偷改为每个人授权。

## 7. 重新登录与停止共享

- Claude 的长期 CI token 失效，或 Codex 内置刷新最终失败：Alice 重新执行“登录并共享”。Codex 正常的自动刷新不需要 Alice 操作；重新授权应在账号锁内发布新的当前认证版本，避免继续恢复旧状态。Bob 个人历史不受影响。
- 停止共享：Claude 删除对应 Secret；Codex 将共享认证标记停用并删除加密 key Secret，再停止该账号仍活跃的 runner。此后该模型入口提示未共享。
- 彻底使已交付的 token 失效：Alice 还需在模型提供方撤销或轮换凭据。仅删除 GitHub Secret 不能收回别人已复制的 token。

首版不支持逐成员撤销。使用者清理自己的浏览器数据后，GitHub 身份仍可重新连接，但旧历史密钥无法自动找回；页面明确说明重新开始，不误导为已恢复。

## 8. 验收

Alice 共享后离线，Bob 与 Carol 能同时聊天且各自只有一个运行中的 runner，历史互不读取或覆盖；Bob 多开标签页、切换 Agent 或启动登录任务不会绕过单 runner 限制；两人各自在同一浏览器重启后可继续。Codex 额外验证 Alice 只授权一次、Bob / Carol 无需再授权、续期自动回写且不会并发旋转同一 refresh token。全流程只需静态页面、GitHub 和包含认证适配的 Morty，没有数据库、常驻后台服务或下载步骤。
