# 项目栏 Git 分支选择器

## 行为

- 点击项目栏的当前分支，打开可搜索的本地／远程分支列表。
- 本地分支直接切换；选择远程分支会创建本地跟踪分支，不进入 detached HEAD。
- “新建分支…”从当前 HEAD 创建并立即切换；搜索文本可预填名称。
- 当前分支、加载中、操作中、空列表、重复名称及失败原因均有明确状态。
- 打开菜单、切换项目、操作成功或应用重新获得焦点时刷新状态。
- Git 审阅面板完成操作时通知分支状态刷新；切换分支后刷新审阅面板。
- 保留现有项目栏显示条件；Pi 正在创建会话或执行任务时禁止切换。
- 支持键盘搜索、上下方向键、Home／End、Enter 提交及 Escape 关闭。

## IPC 与兼容性

新增 Tauri command `git_switch_branch`，参数为 `{ cwd: string, name: string, remote: boolean }`，
成功返回 `void`；Renderer 只能通过 `src/ipc/git.ts` 的 `gitSwitchBranch` 调用。

- `cwd` 先经过 `WorkspaceStore.authorize`，再经过仓库根目录校验。
- 名称复用现有分支名长度和字符校验，并使用完整 `refs/heads/` 或 `refs/remotes/`
  引用验证目标存在。提交 SHA、路径、Git 选项和任意 revision expression 不作为切换目标。
- 启动固定 `git` 程序并逐项传参。本地分支使用 `switch --no-guess`，远程使用
  `switch --track`，不执行网络 fetch，不接收强制覆盖参数。
- 新增错误码 `GIT_BRANCH_NOT_FOUND`、`GIT_BRANCH_SWITCH_FAILED`；继续复用
  `GIT_BRANCH_NAME_INVALID`、工作区和 Git 进程相关错误码。Renderer 不输出原始 stderr。
- 创建分支仍复用 `git_create_branch`；分支列表复用 `workspace_get_worktree_options`。
- 现有 command 参数不变；不修改 Pi Bridge JSONL 协议，协议版本仍为 1。
  新 Renderer 需与包含新 command 的 Rust Core 一起构建和发布。

## 安全与验证

不使用强制 checkout、reset、隐式 stash 或删除分支。冲突的工作区／暂存区改动、
同名本地分支、其他 worktree 已占用的分支交由 Git 拒绝，错误后保留原分支与改动。

Renderer 使用 Mock IPC 测试创建、切换、刷新、错误脱敏、重复点击、工作区切换竞态、
StrictMode、分离 HEAD、空仓库、键盘与菜单关闭；Rust 使用临时 fixture 仓库验证
本地／远程切换、无效目标、未暂存与已暂存改动保护、跟踪分支冲突以及 worktree 占用。
Rust 未配置行覆盖率工具，因此不声明 Rust 行覆盖率达到 80%；以这些安全边界测试补充验证。
