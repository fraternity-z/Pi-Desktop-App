import {
  Check,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ProviderLogin,
  ProviderModelInput,
  ProviderSummary,
} from "../ipc/providers";
import {
  useProviderSettings,
  type ProviderSettingsController,
} from "../stores/useProviderSettings";
import { ConfirmSidebarDialog } from "./SidebarDialog";
import "./ModelProviderSettings.css";

export function ModelProviderSettings() {
  const controller = useProviderSettings();
  const { snapshot, busy, error, status, login } = controller;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "connected" | "oauth">("all");
  const [editor, setEditor] = useState<string | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<ProviderSummary | null>(
    null,
  );
  const providers = snapshot?.providers ?? [];
  const selected =
    providers.find((provider) => provider.id === selectedId) ??
    providers.find(
      (provider) => provider.id === snapshot?.defaultModel?.provider,
    ) ??
    providers[0];
  const visible = providers.filter(
    (provider) =>
      (filter !== "connected" || provider.connected) &&
      (filter !== "oauth" || provider.oauth) &&
      `${provider.name} ${provider.id}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const defaultProvider = providers.find(
    (provider) => provider.id === snapshot?.defaultModel?.provider,
  );
  const defaultModel = defaultProvider?.models.find(
    (model) => model.id === snapshot?.defaultModel?.id,
  );
  const authenticating = login?.status === "pending";
  const locked = busy || authenticating;

  return (
    <section
      className="model-settings"
      aria-label="模型与提供商"
      aria-busy={busy}
    >
      <div className="model-settings-heading">
        <div>
          <h2>模型与提供商</h2>
          <p>连接你的账户，或使用自己的模型服务。</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="刷新提供商"
          title="重新读取 Pi 配置与模型目录"
          disabled={locked}
          onClick={() => void controller.refresh()}
        >
          <RefreshCw size={17} className={busy ? "spin" : undefined} />
        </button>
      </div>

      <div className="model-default-card">
        <span className="model-default-icon">
          <Sparkles size={21} aria-hidden="true" />
        </span>
        <div className="model-default-copy">
          <span className="model-eyebrow">新会话默认模型</span>
          <strong>
            {defaultModel?.name ??
              snapshot?.defaultModel?.id ??
              "尚未设置默认模型"}
          </strong>
          <span>
            {defaultProvider?.name ?? "连接提供商后，在下方选择模型"}
            {defaultModel && !defaultModel.available ? " · 当前不可用" : ""}
          </span>
        </div>
        <span className="model-native-badge">
          <ShieldCheck size={13} aria-hidden="true" />
          Pi 原生配置
        </span>
      </div>

      {error && (
        <p className="model-feedback model-feedback-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="model-feedback model-feedback-success" role="status">
          <Check size={15} />
          {status}
        </p>
      )}
      {snapshot?.warning && (
        <p className="model-feedback" role="status">
          {snapshot.warning}
        </p>
      )}

      <div className="model-section-heading">
        <h3>
          提供商{" "}
          <span>
            {providers.filter((provider) => provider.connected).length} 已连接
          </span>
        </h3>
        <button
          className="primary-button"
          type="button"
          disabled={!snapshot || locked}
          onClick={() => {
            setEditor("");
          }}
        >
          <Plus size={15} />
          添加模型服务
        </button>
      </div>
      <div className="model-provider-toolbar">
        <div className="model-filters" aria-label="筛选提供商">
          {(
            [
              { id: "all", label: "全部" },
              { id: "connected", label: "已连接" },
              { id: "oauth", label: "账户登录" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="model-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索提供商"
            placeholder="搜索提供商"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {!snapshot ? (
        <div className="model-empty">
          {busy ? (
            <>
              <LoaderCircle size={24} className="spin" />
              <strong>正在读取 Pi 模型目录</strong>
            </>
          ) : (
            <>
              <Server size={24} />
              <strong>模型服务暂不可用</strong>
              <span>请先确认「运行时」已就绪，然后重新加载。</span>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void controller.refresh()}
              >
                重新加载
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="model-provider-grid" aria-label="提供商列表">
          {visible.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="model-provider-card"
              aria-pressed={selected?.id === provider.id}
              aria-label={`选择提供商 ${provider.name}`}
              onClick={() => setSelectedId(provider.id)}
            >
              <span className="model-provider-card-top">
                <span className="model-provider-mark" aria-hidden="true">
                  {provider.custom ? (
                    <Server size={19} />
                  ) : (
                    provider.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span
                  className={`model-connection ${provider.connected ? "is-connected" : ""}`}
                >
                  <i />
                  {provider.connected ? "已连接" : "未连接"}
                </span>
              </span>
              <strong>{provider.name}</strong>
              <span className="model-provider-card-meta">
                {provider.authType === "oauth"
                  ? "账户登录"
                  : provider.custom
                    ? "自定义配置"
                    : provider.oauth
                      ? "支持账户登录"
                      : "API / 环境认证"}
                <ChevronRight size={14} />
              </span>
              {snapshot.defaultModel?.provider === provider.id && (
                <span className="model-card-default">
                  <Check size={11} />
                  默认提供商
                </span>
              )}
            </button>
          ))}
          {visible.length === 0 && (
            <div className="model-empty model-empty-compact">
              <Search size={21} />
              <strong>
                {query
                  ? "没有匹配的提供商"
                  : filter === "connected"
                    ? "还没有连接的提供商"
                    : "当前 SDK 未提供此类服务"}
              </strong>
              <span>尝试其他筛选，或添加自定义模型。</span>
            </div>
          )}
        </div>
      )}

      {login && (
        <ProviderLoginPanel
          key={login.id}
          login={login}
          controller={controller}
          providerName={
            providers.find((provider) => provider.id === login.provider)
              ?.name ?? login.provider
          }
        />
      )}
      {editor !== null && snapshot && (
        <ProviderModelEditor
          key={`editor:${editor}`}
          provider={editor}
          revision={snapshot.revision}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            if (await controller.saveModel(input)) {
              setSelectedId(input.provider);
              setEditor(null);
            }
          }}
        />
      )}
      {selected && (
        <ProviderDetail
          key={selected.id}
          provider={selected}
          controller={controller}
          locked={locked}
          onConfigure={() => setEditor(selected.id)}
          onLogout={() => setLogoutTarget(selected)}
        />
      )}

      <p className="model-settings-note">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          模型和登录由 Pi 官方 SDK
          管理。默认模型只影响新会话，当前会话可在聊天框切换。API
          密钥不会回传至界面。
        </span>
      </p>
      {logoutTarget && (
        <ConfirmSidebarDialog
          title={`断开 ${logoutTarget.name}`}
          description="移除 Pi 保存的账户或 API 认证。环境变量、自定义模型和现有会话记录不会被删除；正在运行的任务可能受影响。"
          confirmLabel="断开连接"
          danger
          busy={busy}
          error={error}
          onClose={() => setLogoutTarget(null)}
          onConfirm={() => {
            void controller.logout(logoutTarget.id).then((ok) => {
              if (ok) setLogoutTarget(null);
            });
          }}
        />
      )}
    </section>
  );
}

function ProviderDetail({
  provider,
  controller,
  locked,
  onConfigure,
  onLogout,
}: {
  provider: ProviderSummary;
  controller: ProviderSettingsController;
  locked: boolean;
  onConfigure: () => void;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const models = provider.models.filter((model) =>
    `${model.name} ${model.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="model-provider-detail"
      aria-label={`${provider.name} 模型`}
    >
      <div className="model-detail-heading">
        <div>
          <h3>{provider.name}</h3>
          <p>
            {provider.id} · {provider.models.length} 个模型
          </p>
        </div>
        <div className="model-detail-actions">
          {provider.oauth && (
            <button
              className={
                provider.connected ? "secondary-button" : "primary-button"
              }
              type="button"
              disabled={locked}
              onClick={() => void controller.startLogin(provider.id)}
            >
              <LogIn size={14} />
              {provider.authType === "oauth" ? "重新登录" : "登录账户"}
            </button>
          )}
          <button
            className="secondary-button"
            type="button"
            disabled={locked}
            onClick={onConfigure}
          >
            <Settings2 size={14} />
            配置模型
          </button>
          {provider.storedCredential && (
            <button
              className="icon-button"
              type="button"
              aria-label={`断开 ${provider.name}`}
              title="断开连接"
              disabled={locked}
              onClick={onLogout}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
      {!provider.connected && (
        <p className="model-connection-hint">
          <CircleHelp size={15} />
          <span>
            {provider.oauth
              ? "可使用已有账户登录，也可配置 API 模型。"
              : "复用 Pi CLI 已保存的认证或系统环境变量；配置完成后刷新目录。"}
          </span>
        </p>
      )}
      <label className="model-search model-search-wide">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label={`搜索 ${provider.name} 模型`}
          placeholder="搜索模型名称或 ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="model-catalog">
        {models.map((model) => {
          const active =
            controller.snapshot?.defaultModel?.provider === provider.id &&
            controller.snapshot.defaultModel.id === model.id;
          return (
            <div className="model-catalog-row" key={model.id}>
              <div className="model-catalog-copy">
                <strong>
                  {model.name}
                  {model.reasoning && (
                    <span className="model-reasoning">
                      <Sparkles size={11} />
                      思考
                    </span>
                  )}
                </strong>
                <span>{model.id}</span>
              </div>
              <button
                className={`model-select-button ${active ? "is-default" : ""}`}
                type="button"
                disabled={locked || !model.available || active}
                aria-label={
                  active
                    ? `${model.name} 已是默认模型`
                    : `将 ${model.name} 设为默认模型`
                }
                onClick={() =>
                  void controller.setDefault(provider.id, model.id)
                }
              >
                {active ? (
                  <>
                    <Check size={14} />
                    默认
                  </>
                ) : model.available ? (
                  "设为默认"
                ) : (
                  "需连接"
                )}
              </button>
            </div>
          );
        })}
        {models.length === 0 && (
          <div className="model-empty model-empty-compact">
            <span>
              {query
                ? "没有匹配的模型"
                : "暂无模型，连接账户后刷新或添加自定义模型。"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ProviderLoginPanel({
  login,
  providerName,
  controller,
}: {
  login: ProviderLogin;
  providerName: string;
  controller: ProviderSettingsController;
}) {
  const [input, setInput] = useState("");
  useEffect(() => {
    setInput("");
  }, [login.prompt?.id]);
  const pending = login.status === "pending";
  return (
    <section
      className={`model-login-panel ${login.status === "error" ? "has-error" : ""}`}
      aria-label={`${providerName} 账户登录`}
    >
      <div className="model-detail-heading">
        <div>
          <h3>
            {pending ? (
              <LoaderCircle className="spin" size={16} />
            ) : login.status === "success" ? (
              <Check size={16} />
            ) : (
              <LogIn size={16} />
            )}
            {providerName} 账户登录
          </h3>
          <p role="status">{login.message}</p>
        </div>
        {pending && (
          <button
            className="secondary-button"
            type="button"
            disabled={controller.busy}
            onClick={() => void controller.cancelLogin()}
          >
            取消登录
          </button>
        )}
      </div>
      {login.userCode && (
        <div className="model-device-code">
          <span>在官方授权页面输入设备码</span>
          <code>{login.userCode}</code>
        </div>
      )}
      {pending && login.url && (
        <button
          className="primary-button"
          type="button"
          disabled={controller.busy}
          onClick={() => void controller.openLogin()}
        >
          <ExternalLink size={15} />
          打开官方授权页面
        </button>
      )}
      {pending && login.prompt && (
        <form
          className="model-login-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = input;
            setInput("");
            void controller.reply(login.prompt!.id, value);
          }}
        >
          <label>
            <span>{login.prompt.message}</span>
            {login.prompt.type === "select" ? (
              <select
                aria-label="官方登录选项"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={controller.busy}
              >
                <option value="">请选择</option>
                {login.prompt.options?.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="官方登录输入"
                type="text"
                value={input}
                autoComplete="off"
                spellCheck={false}
                maxLength={8192}
                disabled={controller.busy}
                placeholder={
                  login.prompt.type === "manual_code"
                    ? "粘贴官方页面提供的授权码或回调地址"
                    : "按官方提示输入"
                }
                onChange={(event) => setInput(event.target.value)}
              />
            )}
          </label>
          <button
            className="secondary-button"
            type="submit"
            disabled={controller.busy || !input.trim()}
          >
            继续
          </button>
        </form>
      )}
      {login.status === "error" && (
        <button
          className="secondary-button"
          type="button"
          disabled={controller.busy}
          onClick={() => void controller.startLogin(login.provider)}
        >
          重新登录
        </button>
      )}
    </section>
  );
}

function ProviderModelEditor({
  provider,
  revision,
  busy,
  error,
  onClose,
  onSave,
}: {
  provider: string;
  revision: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: ProviderModelInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    provider,
    baseUrl: "",
    api: "openai-completions" as ProviderModelInput["api"],
    apiKeyEnv: "",
    modelId: "",
    modelName: "",
    reasoning: false,
    contextWindow: "128000",
    maxTokens: "8192",
  });
  // Keep the revision at editor-open time: a refresh must not silently authorize overwriting concurrent edits.
  const [expectedRevision] = useState(revision);
  const change = (key: keyof typeof draft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const invalidLimits = Number(draft.maxTokens) > Number(draft.contextWindow);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalidLimits) return;
    const { apiKeyEnv, ...fields } = draft;
    void onSave({
      ...fields,
      provider: fields.provider.trim(),
      modelId: fields.modelId.trim(),
      modelName: fields.modelName.trim() || fields.modelId.trim(),
      baseUrl: fields.baseUrl.trim(),
      ...(apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}),
      contextWindow: Number(draft.contextWindow),
      maxTokens: Number(draft.maxTokens),
      expectedRevision,
    });
  }
  return (
    <section className="model-editor" aria-label="配置自定义模型">
      <div className="model-detail-heading">
        <div>
          <h3>
            <Server size={17} />
            {provider ? "配置模型" : "添加模型服务"}
          </h3>
          <p>兼容 Pi models.json，保存后与 Pi CLI 共用。</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭模型配置"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <form className="model-editor-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="model-form-grid">
            <label>
              <span>提供商 ID</span>
              <input
                required
                pattern="[a-z0-9][a-z0-9._-]*"
                maxLength={128}
                placeholder="例如 my-provider"
                value={draft.provider}
                onChange={(event) => change("provider", event.target.value)}
              />
            </label>
            <label>
              <span>API 协议</span>
              <select
                value={draft.api}
                onChange={(event) => change("api", event.target.value)}
              >
                <option value="openai-completions">
                  OpenAI Chat Completions
                </option>
                <option value="openai-responses">OpenAI Responses</option>
                <option value="anthropic-messages">Anthropic Messages</option>
                <option value="google-generative-ai">
                  Google Generative AI
                </option>
              </select>
            </label>
            <label className="model-form-wide">
              <span>API 端点</span>
              <input
                required
                type="url"
                maxLength={2048}
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl}
                onChange={(event) => change("baseUrl", event.target.value)}
              />
            </label>
            <label className="model-form-wide">
              <span>
                <KeyRound size={13} />
                API Key 环境变量 <small>可选</small>
              </span>
              <input
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={128}
                autoComplete="off"
                spellCheck={false}
                placeholder="例如 MY_PROVIDER_API_KEY（不是密钥本身）"
                value={draft.apiKeyEnv}
                onChange={(event) => change("apiKeyEnv", event.target.value)}
              />
              <small>
                只保存变量名。请先在系统设置环境变量并重启应用；留空则保留 Pi
                已有认证。新提供商仍需完成 Pi 认证配置后才能使用。
              </small>
            </label>
            <label>
              <span>模型 ID</span>
              <input
                required
                maxLength={256}
                placeholder="服务端的模型标识"
                value={draft.modelId}
                onChange={(event) => change("modelId", event.target.value)}
              />
            </label>
            <label>
              <span>
                显示名称 <small>可选</small>
              </span>
              <input
                maxLength={256}
                placeholder="默认使用模型 ID"
                value={draft.modelName}
                onChange={(event) => change("modelName", event.target.value)}
              />
            </label>
            <label>
              <span>上下文窗口</span>
              <input
                required
                type="number"
                min={1}
                max={10000000}
                step={1}
                value={draft.contextWindow}
                onChange={(event) =>
                  change("contextWindow", event.target.value)
                }
              />
            </label>
            <label>
              <span>最大输出 Token</span>
              <input
                required
                type="number"
                min={1}
                max={10000000}
                step={1}
                value={draft.maxTokens}
                onChange={(event) => change("maxTokens", event.target.value)}
              />
            </label>
          </div>
          <label className="model-checkbox">
            <input
              type="checkbox"
              checked={draft.reasoning}
              onChange={(event) => change("reasoning", event.target.checked)}
            />
            支持思考模式
          </label>
        </fieldset>
        <p className="model-form-help">
          请按服务商文档填写模型上限。相同模型 ID 会更新已有条目；端点和 API
          协议对该提供商所有模型生效。
        </p>
        {invalidLimits && (
          <p className="model-feedback-error" role="alert">
            最大输出不能超过上下文窗口。
          </p>
        )}
        {error && (
          <p className="model-feedback-error" role="alert">
            {error}
          </p>
        )}
        <div className="model-editor-footer">
          <span>
            <ShieldCheck size={14} />
            不读取或展示现有密钥
          </span>
          <button
            className="primary-button"
            type="submit"
            disabled={busy || invalidLimits}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Plus size={15} />
            )}
            保存模型
          </button>
        </div>
      </form>
    </section>
  );
}
