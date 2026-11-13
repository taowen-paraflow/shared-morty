export type ErrorCode =
    | "provider_failed"
    | "unsafe_execution"
    | "runner_busy"
    | "conflict"
    | "invalid_input"
    | "unauthenticated"
    | "forbidden"
    | "repository_unavailable"
    | "rate_limited"
    | "invalid_response"
    | "too_many_runs"
    | "unavailable"
    | "cancelled"
    | "timeout";

const messages: Readonly<Record<ErrorCode, string>> = {
    provider_failed: "Claude 登录未成功，请返回共享设置后重新授权。",
    unsafe_execution: "执行环境校验失败：需要默认分支和可验证的本人 workflow 任务。",
    runner_busy: "你已有尚未结束的 runner，请刷新状态或处理现有任务。",
    conflict: "GitHub 未接受操作，任务可能已结束或 workflow 配置不匹配，请刷新状态。",
    invalid_input: "请检查执行仓库、Token 和请求参数。",
    unauthenticated: "GitHub Token 无效或已过期。",
    forbidden: "当前账号或 Token 没有执行此操作的权限。",
    repository_unavailable: "无法访问执行仓库，请检查仓库名称与读取权限。",
    rate_limited: "GitHub 请求受限，请稍后重试。",
    invalid_response: "GitHub 返回了无法验证的数据，未将其视为空环境。",
    too_many_runs: "运行记录超出本次可验证范围，无法可靠确认当前环境。",
    unavailable: "暂时无法连接 GitHub，请重试。",
    cancelled: "请求已取消。",
    timeout: "等待操作完成超时，请重试。",
};

export class AppError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, cause?: unknown) {
        super(messages[code], { cause });
        this.name = "AppError";
        this.code = code;
    }
}

export function publicError(error: unknown): AppError {
    return error instanceof AppError ? error : new AppError("unavailable", error);
}
