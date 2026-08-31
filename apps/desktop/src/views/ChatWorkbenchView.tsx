import {
  AlertTriangle,
  ArrowDown,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Menu,
  MessageSquarePlus,
  PanelRight,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { AppSidebar, threadTitle } from "../components/AppSidebar";
import { BrowserSidebarPanel } from "../components/BrowserSidebarPanel";
import { ChatComposer } from "../components/ChatComposer";
import {
  MAX_COMPOSER_ATTACHMENTS,
  normalizeAttachedPaths,
} from "../components/composerAttachments";
import { ConversationTimeline } from "../components/ConversationTimeline";
import { FileSearchDialog, type FileSearchResult } from "../components/FileSearchDialog";
import { FileViewer } from "../components/FileViewer";
import { GitReviewPanel } from "../components/GitReviewPanel";
import { QuickPreview } from "../components/QuickPreview";
import { RightPanel, type RightPanelTabId } from "../components/RightPanel";
import { RuntimeStatusControl } from "../components/RuntimeStatusControl";
import { SettingsSidebar, type SettingsSectionId } from "../components/SettingsSidebar";
import {
  listAgentCommands,
  type AgentSlashCommand,
  type PromptStreamingBehavior,
} from "../ipc/agent";
import {
  selectAttachmentDirectory,
  selectAttachmentFiles,
  selectProjectDirectory,
} from "../ipc/project";
import {
  createWorkspaceWorktree,
  getWorktreeOptions,
  openWorkspaceFile,
  readWorkspaceFile,
  revealWorkspace,
  revealWorkspaceFile,
  saveClipboardImage,
  searchWorkspacePaths,
} from "../ipc/workspace";
import { useAppPreferences } from "../stores/useAppPreferences";
import { useAgentEcosystem } from "../stores/useAgentEcosystem";
import { useChatSession, type SessionListItem } from "../stores/useChatSession";
import { useRequestHeaderSettings } from "../stores/useRequestHeaderSettings";
import { useDesktopNotifications } from "../stores/useDesktopNotifications";
import { useRuntimeStatus } from "../stores/useRuntimeStatus";
import {
  commentsForFile,
  createLocalCodeComment,
  readLocalCodeComments,
  writeLocalCodeComments,
  type CreateLocalCodeCommentInput,
} from "../stores/localCodeComments";
import {
  createRightPanelFileTarget,
  decodeBase64Utf8,
  formatRightPanelError,
  type RightPanelFileTarget,
} from "../stores/rightPanelFiles";
import { useRightPanelLayout, useRightPanelVisibility } from "../stores/useRightPanelLayout";
import { useSidebarPreferences } from "../stores/useSidebarPreferences";
import { useToolPermissions } from "../stores/useToolPermissions";
import {
  buildComposerCommandCatalog,
  parseSlashLine,
  type ComposerCommand,
} from "../components/composerCommands";
import { PackageManagerView, ResourcesView } from "./EcosystemViews";
import { SettingsView } from "./SettingsView";
import appIconUrl from "../../../../src-tauri/icons/64x64.png";

interface RightPanelFileLoadState {
  readonly targetPath: string | null;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly dataBase64: string;
  readonly content: string;
  readonly error: string | null;
}

const EMPTY_RIGHT_PANEL_FILE_STATE: RightPanelFileLoadState = {
  targetPath: null,
  status: "idle",
  dataBase64: "",
  content: "",
  error: null,
};

export function ChatWorkbenchView() {
  const runtime = useRuntimeStatus();
  const session = useChatSession();
  const toolPermissions = useToolPermissions(session.configuration);
  const ecosystem = useAgentEcosystem();
  const sidebarPreferences = useSidebarPreferences();
  const requestHeaders = useRequestHeaderSettings();
  const { preferences, updatePreferences } = useAppPreferences();
  const notifications = useDesktopNotifications(preferences, updatePreferences);
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowViewport());
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [activeView, setActiveView] = useState<"chat" | "settings" | "packages" | "resources">(
    "chat",
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectSelectionError, setProjectSelectionError] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pastedImagePaths, setPastedImagePaths] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [slashCommands, setSlashCommands] = useState<AgentSlashCommand[]>([]);
  const [slashCommandsPhase, setSlashCommandsPhase] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [slashCommandsError, setSlashCommandsError] = useState<string | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const pendingConversationScroll = useRef<(() => void) | null>(null);
  const projectDialogTrigger = useRef<HTMLElement | null>(null);
  const rightPanelTrigger = useRef<HTMLButtonElement | null>(null);
  const ecosystemRequestKey = useRef("");
  const [atConversationBottom, setAtConversationBottom] = useState(true);
  const hasSession = session.sessionId !== null;
  const rightPanelEnabled =
    activeView === "chat" && hasSession && isProjectWorkspace(session.cwd, session.conversationHome);
  const rightPanelLayout = useRightPanelLayout();
  const rightPanelVisibility = useRightPanelVisibility(rightPanelEnabled);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTabId>("review");
  const [browserTabOpen, setBrowserTabOpen] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileTab, setFileTab] = useState<RightPanelFileTarget | null>(null);
  const [previewTab, setPreviewTab] = useState<RightPanelFileTarget | null>(null);
  const [fileReloadKey, setFileReloadKey] = useState(0);
  const [rightPanelFileState, setRightPanelFileState] = useState<RightPanelFileLoadState>(
    EMPTY_RIGHT_PANEL_FILE_STATE,
  );
  const [localCodeComments, setLocalCodeComments] = useState(readLocalCodeComments);
  const activeRightPanelFile = rightPanelTab === "file"
    ? fileTab
    : rightPanelTab === "preview"
      ? previewTab
      : null;

  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const runtimeStarting =
    runtime.phase === "loading" ||
    (runtime.phase === "ready" && runtime.status.status === "starting");
  const eventChannelReady = session.eventConnection === "ready";
  const startupStage = !hasSession
    ? runtimeStarting
      ? "runtime"
      : runtimeReady && session.eventConnection === "connecting"
        ? "events"
        : null
    : null;
  const workspaceName = getWorkspaceName(session.cwd);
  const activeSession = session.sessions.find((item) => item.id === session.sessionId);
  const conversationTitle = activeSession
    ? threadTitle(activeSession, sidebarPreferences.preferences.threadAliases)
    : workspaceName;
  const managementCwd =
    session.cwd || session.recentWorkspaces[0] || session.conversationHome;
  const canSend =
    hasSession &&
    (session.phase === "ready" || session.phase === "streaming") &&
    eventChannelReady &&
    !session.configuring &&
    (draft.trim().length > 0 || attachments.length > 0);
  const lastMessage = session.messages.at(-1);
  const conversationRevision = `${session.messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.content.length ?? 0}:${lastMessage?.status ?? ""}`;

  const scheduleConversationScroll = useCallback(
    (behavior: ScrollBehavior = "auto", replacePending = false) => {
      if (replacePending) {
        pendingConversationScroll.current?.();
        pendingConversationScroll.current = null;
      }
      if (pendingConversationScroll.current) return;
      pendingConversationScroll.current = scheduleAfterLayout(() => {
        pendingConversationScroll.current = null;
        scrollConversationToBottom(conversationScroll.current, messagesEnd.current, behavior);
      });
    },
    [],
  );

  useEffect(() => {
    if (shouldStickToBottom.current) {
      scheduleConversationScroll();
    }
  }, [conversationRevision, scheduleConversationScroll]);

  useEffect(() => {
    shouldStickToBottom.current = true;
    setAtConversationBottom(true);
    scheduleConversationScroll("auto", true);
  }, [scheduleConversationScroll, session.sessionId]);

  useEffect(
    () => () => {
      pendingConversationScroll.current?.();
      pendingConversationScroll.current = null;
    },
    [],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem("pi-desktop.sidebar-width", String(sidebarWidth));
    } catch {
      // Local persistence is optional; the in-memory width remains usable.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (runtimeReady && eventChannelReady && session.catalogPhase === "idle") {
      void session.loadCatalogs();
    }
  }, [eventChannelReady, runtimeReady, session.catalogPhase, session.loadCatalogs]);

  useEffect(() => {
    const sessionId = session.sessionId;
    if (!runtimeReady || !eventChannelReady || !sessionId || sessionId.startsWith("draft:")) {
      setSlashCommands([]);
      setSlashCommandsPhase("idle");
      setSlashCommandsError(null);
      return;
    }
    let cancelled = false;
    setSlashCommands([]);
    setSlashCommandsPhase("loading");
    setSlashCommandsError(null);
    void listAgentCommands(sessionId)
      .then((commands) => {
        if (cancelled) return;
        setSlashCommands(commands);
        setSlashCommandsPhase("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSlashCommands([]);
        setSlashCommandsPhase("error");
        setSlashCommandsError(formatCommandError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [eventChannelReady, runtimeReady, session.sessionId]);

  useEffect(() => {
    if (activeView !== "packages" && activeView !== "resources") {
      ecosystemRequestKey.current = "";
      return;
    }
    if (!runtimeReady || !eventChannelReady || !managementCwd) return;
    const requestKey = `${activeView}:${normalizeComparablePath(managementCwd)}`;
    if (ecosystemRequestKey.current === requestKey) return;
    ecosystemRequestKey.current = requestKey;
    void ecosystem.refresh(managementCwd, activeView);
  }, [activeView, ecosystem.refresh, eventChannelReady, managementCwd, runtimeReady]);

  useEffect(() => {
    if (!session.cwd) {
      setBranchName(null);
      return;
    }
    let cancelled = false;
    void getWorktreeOptions(session.cwd)
      .then((options) => {
        if (!cancelled) setBranchName(options.branches.find((branch) => branch.current)?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setBranchName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session.cwd]);

  useEffect(() => {
    setFileSearchOpen(false);
    setFileTab(null);
    setPreviewTab(null);
    setRightPanelTab("review");
    setRightPanelFileState(EMPTY_RIGHT_PANEL_FILE_STATE);
  }, [session.cwd]);

  useEffect(() => {
    if (activeRightPanelFile === null || !session.cwd) return undefined;
    const target = activeRightPanelFile;
    if (!requiresWorkspaceFileRead(target)) {
      setRightPanelFileState({
        targetPath: target.path,
        status: "ready",
        dataBase64: "",
        content: "",
        error: null,
      });
      return undefined;
    }
    let cancelled = false;
    setRightPanelFileState({
      targetPath: target.path,
      status: "loading",
      dataBase64: "",
      content: "",
      error: null,
    });
    void readWorkspaceFile(session.cwd, target.path)
      .then((result) => {
        if (cancelled) return;
        const content = target.tab === "file" || target.previewKind === "markdown" || target.previewKind === "text"
          ? decodeBase64Utf8(result.dataBase64)
          : "";
        setRightPanelFileState({
          targetPath: target.path,
          status: "ready",
          dataBase64: result.dataBase64,
          content,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRightPanelFileState({
          targetPath: target.path,
          status: "error",
          dataBase64: "",
          content: "",
          error: formatRightPanelError(error, "WORKSPACE_FILE_READ_FAILED", "无法读取工作区文件"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeRightPanelFile, fileReloadKey, session.cwd]);

  useEffect(() => {
    if (!rightPanelVisibility.open) setFileSearchOpen(false);
  }, [rightPanelVisibility.open]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!runtimeReady || !eventChannelReady || session.phase === "creating") {
      return;
    }
    if (await session.createSession(projectPath)) {
      resetComposerInput();
      setProjectPath("");
      setProjectSelectionError(null);
      setProjectDialogOpen(false);
      closeSidebarAfterNavigation();
    }
  }

  function openProjectDialog() {
    session.cancelAutoRestore();
    projectDialogTrigger.current = document.activeElement as HTMLElement | null;
    setProjectSelectionError(null);
    setProjectDialogOpen(true);
  }

  function closeProjectDialog() {
    if (session.phase === "creating" || selectingProject) {
      return;
    }
    setProjectPath("");
    setProjectSelectionError(null);
    setProjectDialogOpen(false);
    window.setTimeout(() => projectDialogTrigger.current?.focus(), 0);
  }

  async function chooseProjectDirectory() {
    if (session.phase === "creating" || selectingProject) {
      return;
    }
    setProjectSelectionError(null);
    setSelectingProject(true);
    try {
      const selected = await selectProjectDirectory();
      if (selected !== null) {
        setProjectPath(selected);
      }
    } catch (selectionError) {
      setProjectSelectionError(formatProjectSelectionError(selectionError));
    } finally {
      setSelectingProject(false);
    }
  }

  async function createSession(cwd?: string) {
    if (!cwd) {
      openProjectDialog();
      return;
    }
    if (await session.createSession(cwd)) {
      resetComposerInput();
      closeSidebarAfterNavigation();
    }
  }

  async function createConversation() {
    if (await session.createConversation()) {
      resetComposerInput();
      closeSidebarAfterNavigation();
    }
  }

  async function openSession(selected: SessionListItem) {
    if (await session.openSession(selected)) {
      resetComposerInput();
      closeSidebarAfterNavigation();
    }
  }

  function closeSidebarAfterNavigation() {
    if (preferences.closeSidebarOnNavigation) {
      closeSidebarOnNarrowScreen(setSidebarOpen);
    }
  }

  function openSettings() {
    session.cancelAutoRestore();
    setSettingsSection("general");
    setActiveView("settings");
    closeSidebarAfterNavigation();
  }

  function openEcosystem(view: "packages" | "resources") {
    session.cancelAutoRestore();
    setActiveView(view);
    closeSidebarAfterNavigation();
  }

  function leaveEcosystem() {
    setActiveView("chat");
    closeSidebarAfterNavigation();
  }

  function leaveSettings() {
    setActiveView("chat");
    closeSidebarAfterNavigation();
    scheduleConversationScroll("auto", true);
  }

  function openSettingsSection(section: SettingsSectionId) {
    setSettingsSection(section);
    closeSidebarAfterNavigation();
  }

  async function removeWorkspace(cwd: string) {
    await session.removeWorkspace(cwd);
  }

  async function openCreatedWorktree(cwd: string) {
    if (!(await session.createSession(cwd))) {
      throw {
        code: "WORKTREE_OPEN_FAILED",
        message: "工作树已创建，但无法打开新会话",
      };
    }
    closeSidebarAfterNavigation();
  }

  function sendPrompt(event?: FormEvent, behavior?: PromptStreamingBehavior) {
    event?.preventDefault();
    const prompt = draft;
    const imagePaths = pastedImagePaths;
    const imagePathSet = new Set(imagePaths);
    const attachedPaths = attachments.filter((path) => !imagePathSet.has(path));
    if (attachedPaths.length === 0 && imagePaths.length === 0 && runBuiltinCommand(prompt)) {
      resetComposerInput();
      return;
    }
    if (!canSend) {
      return;
    }
    shouldStickToBottom.current = true;
    setAtConversationBottom(true);
    setDraft("");
    setAttachments([]);
    setPastedImagePaths([]);
    setAttachmentError(null);
    void session
      .sendPrompt(prompt, behavior, toolPermissions.promptToolNames, attachedPaths, imagePaths)
      .then((sent) => {
        if (!sent) {
          setDraft((current) => current || prompt);
          setAttachments((current) =>
            normalizeAttachedPaths([...attachedPaths, ...imagePaths, ...current]),
          );
          setPastedImagePaths((current) => normalizeAttachedPaths([...imagePaths, ...current]));
        }
      });
  }

  function runBuiltinCommand(prompt: string): boolean {
    const parsed = parseSlashLine(prompt);
    if (!parsed) return false;
    const normalizedName = parsed.name.toLocaleLowerCase("en-US");
    const catalog = buildComposerCommandCatalog(slashCommands);
    // Runtime commands may intentionally use a name that is also a legacy
    // built-in alias, so an exact registration always wins over aliasing.
    const exactCommand = catalog.find(
      (item) => item.name.toLocaleLowerCase("en-US") === normalizedName,
    );
    const aliasName =
      normalizedName === "models"
        ? "model"
        : normalizedName === "keybindings"
          ? "hotkeys"
          : normalizedName;
    const canonicalName = exactCommand ? normalizedName : aliasName;
    const command =
      exactCommand ??
      catalog.find((item) => item.name.toLocaleLowerCase("en-US") === canonicalName);
    if (!command || command.source !== "builtin") return false;

    switch (canonicalName) {
      case "new":
        void createConversation();
        return true;
      case "settings":
        openSettings();
        return true;
      case "session":
        session.cancelAutoRestore();
        setSidebarOpen(true);
        return true;
      case "name":
        if (session.sessionId && parsed.args) {
          sidebarPreferences.setThreadAlias(session.sessionId, parsed.args);
        }
        setSidebarOpen(true);
        return true;
      case "packages":
        openEcosystem("packages");
        return true;
      case "resources":
        openEcosystem("resources");
        return true;
      case "reload":
        void runtime.refresh();
        return true;
      case "hotkeys":
        session.cancelAutoRestore();
        setSettingsSection("behavior");
        setActiveView("settings");
        closeSidebarAfterNavigation();
        return true;
      case "model": {
        const separator = parsed.args.indexOf("/");
        if (separator > 0 && separator < parsed.args.length - 1) {
          const provider = parsed.args.slice(0, separator).trim();
          const id = parsed.args.slice(separator + 1).trim();
          if (provider && id) void session.updateModel(provider, id);
        } else {
          openSettings();
        }
        return true;
      }
      default:
        return false;
    }
  }

  function resetComposerInput() {
    setDraft("");
    setAttachments([]);
    setPastedImagePaths([]);
    setAttachmentError(null);
  }

  const addAttachments = useCallback(
    (paths: string[]) => {
      const next = normalizeAttachedPaths([...attachments, ...paths]);
      setAttachments(next);
      setAttachmentError(
        attachments.length + paths.length > MAX_COMPOSER_ATTACHMENTS
          ? `最多可添加 ${MAX_COMPOSER_ATTACHMENTS} 个附件`
          : null,
      );
    },
    [attachments],
  );

  const addPastedImages = useCallback(
    async (files: File[]) => {
      const available = MAX_COMPOSER_ATTACHMENTS - attachments.length;
      if (available <= 0) {
        setAttachmentError(`最多可添加 ${MAX_COMPOSER_ATTACHMENTS} 个附件`);
        return;
      }
      const selected = files.slice(0, available);
      const saved: string[] = [];
      try {
        for (const file of selected) {
          saved.push(await saveClipboardImage(file));
        }
        addAttachments(saved);
        setPastedImagePaths((current) => normalizeAttachedPaths([...current, ...saved]));
        if (selected.length < files.length) {
          setAttachmentError(`最多可添加 ${MAX_COMPOSER_ATTACHMENTS} 个附件`);
        }
      } catch (error) {
        if (saved.length > 0) {
          addAttachments(saved);
          setPastedImagePaths((current) => normalizeAttachedPaths([...current, ...saved]));
        }
        setAttachmentError(formatAttachmentError(error));
      }
    },
    [addAttachments, attachments.length],
  );

  const addFiles = useCallback(async () => {
    try {
      addAttachments(await selectAttachmentFiles());
    } catch (error) {
      setAttachmentError(formatProjectSelectionError(error));
    }
  }, [addAttachments]);

  const addFolder = useCallback(async () => {
    try {
      const path = await selectAttachmentDirectory();
      if (path) addAttachments([path]);
    } catch (error) {
      setAttachmentError(formatProjectSelectionError(error));
    }
  }, [addAttachments]);

  const searchComposerPaths = useCallback(
    (query: string) =>
      session.cwd ? searchWorkspacePaths(session.cwd, query, 24) : Promise.resolve([]),
    [session.cwd],
  );

  const searchRightPanelFiles = useCallback(
    async (query: string): Promise<ReadonlyArray<FileSearchResult>> => {
      if (!session.cwd) return [];
      const matches = await searchWorkspacePaths(session.cwd, query, 24);
      return matches
        .filter((match) => match.kind === "file")
        .map((match) => ({ path: match.path, name: match.relativePath.split(/[\\/]/).at(-1), root: session.cwd }));
    },
    [session.cwd],
  );

  const openRightPanelFileSearch = useCallback(() => {
    if (!rightPanelEnabled) return;
    setFileSearchOpen(true);
  }, [rightPanelEnabled]);

  const openRightPanelFile = useCallback((file: FileSearchResult) => {
    const target = createRightPanelFileTarget(file.path);
    if (target.tab === "preview") {
      setPreviewTab(target);
      setRightPanelTab("preview");
    } else {
      setFileTab(target);
      setRightPanelTab("file");
    }
    setFileSearchOpen(false);
    rightPanelVisibility.openPanel();
  }, [rightPanelVisibility]);

  const closeRightPanelFile = useCallback(() => {
    setFileTab(null);
    setRightPanelTab((current) => current === "file" ? "review" : current);
  }, []);

  const closeRightPanelPreview = useCallback(() => {
    setPreviewTab(null);
    setRightPanelTab((current) => current === "preview" ? "review" : current);
  }, []);

  const createRightPanelComment = useCallback((input: Omit<CreateLocalCodeCommentInput, "rootPath" | "filePath">) => {
    if (!session.cwd || fileTab === null) return;
    const comment = createLocalCodeComment({
      ...input,
      rootPath: session.cwd,
      filePath: fileTab.path,
    });
    setLocalCodeComments((current) => {
      const next = [...current, comment];
      writeLocalCodeComments(next);
      return next;
    });
  }, [fileTab, session.cwd]);

  const deleteRightPanelComment = useCallback((commentId: string) => {
    setLocalCodeComments((current) => {
      const next = current.filter((comment) => comment.id !== commentId);
      writeLocalCodeComments(next);
      return next;
    });
  }, []);

  const openActiveRightPanelFile = useCallback(async () => {
    if (!session.cwd || activeRightPanelFile === null) return;
    await openWorkspaceFile(session.cwd, activeRightPanelFile.path);
  }, [activeRightPanelFile, session.cwd]);

  const revealActiveRightPanelFile = useCallback(async () => {
    if (!session.cwd || activeRightPanelFile === null) return;
    await revealWorkspaceFile(session.cwd, activeRightPanelFile.path);
  }, [activeRightPanelFile, session.cwd]);

  const openRightPanelBrowser = useCallback(() => {
    if (!rightPanelEnabled) return;
    setBrowserTabOpen(true);
    setRightPanelTab("browser");
    rightPanelVisibility.openPanel();
  }, [rightPanelEnabled, rightPanelVisibility]);

  const closeRightPanelBrowser = useCallback(() => {
    setBrowserTabOpen(false);
    setRightPanelTab((current) => current === "browser" ? "review" : current);
  }, []);

  const closeRightPanel = useCallback(() => {
    rightPanelVisibility.closePanel();
    window.setTimeout(() => rightPanelTrigger.current?.focus(), 0);
  }, [rightPanelVisibility]);

  const setRightPanelExpanded = useCallback((expanded: boolean) => {
    if (expanded && !rightPanelLayout.expanded) rightPanelLayout.resetWidth();
    rightPanelLayout.setExpanded(expanded);
  }, [rightPanelLayout]);

  const runtimeMessage = getRuntimeMessage(runtime);
  const eventChannelFailed = session.eventConnection === "error";
  const sessionError =
    session.error && !session.error.startsWith("AGENT_EVENT_") ? session.error : null;

  return (
    <div
      className="desktop-shell"
      data-sidebar-open={sidebarOpen}
      data-right-panel-open={rightPanelVisibility.open}
      data-active-view={activeView}
      style={{
        "--sidebar-width": `${sidebarOpen ? sidebarWidth : 0}px`,
        "--right-panel-shell-width": rightPanelVisibility.available && !rightPanelLayout.expanded
          ? `${rightPanelLayout.width}px`
          : "0px",
      } as CSSProperties}
    >
      {activeView === "settings" ? (
        <SettingsSidebar
          open={sidebarOpen}
          width={sidebarWidth}
          activeSection={settingsSection}
          onBack={leaveSettings}
          onSectionChange={openSettingsSection}
          onClose={() => setSidebarOpen(false)}
          onWidthChange={setSidebarWidth}
        />
      ) : (
        <AppSidebar
          open={sidebarOpen}
          width={sidebarWidth}
          activeCwd={session.cwd}
          activeSessionId={session.sessionId}
          activeView={activeView === "packages" || activeView === "resources" ? activeView : "chat"}
          sessions={session.sessions}
          recentWorkspaces={session.recentWorkspaces}
          conversationHome={session.conversationHome}
          runningSessionIds={session.runningSessionIds}
          catalogPhase={session.catalogPhase}
          ecosystemPhase={ecosystem.phase}
          packageCount={ecosystem.packages.length}
          resourceCount={ecosystem.resources.length}
          phase={session.phase}
          runtime={runtime}
          onAddProject={openProjectDialog}
          onNewConversation={(cwd) =>
            cwd ? void createSession(cwd) : void createConversation()
          }
          onNewSession={(cwd) => void createSession(cwd)}
          onRemoveWorkspace={(cwd) => void removeWorkspace(cwd)}
          onDeleteSession={(sessionId) => session.deleteSessions([sessionId])}
          onRevealWorkspace={revealWorkspace}
          onLoadWorktreeOptions={getWorktreeOptions}
          onCreateWorktree={createWorkspaceWorktree}
          onOpenCreatedWorktree={openCreatedWorktree}
          onSelectSession={(selected) => void openSession(selected)}
          onRefresh={() => void session.loadCatalogs()}
          onOpenPackages={() => openEcosystem("packages")}
          onOpenResources={() => openEcosystem("resources")}
          onOpenSettings={openSettings}
          onClose={() => setSidebarOpen(false)}
          onWidthChange={setSidebarWidth}
        />
      )}
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭侧边栏"
        />
      )}

      {activeView === "settings" ? (
        <SettingsView
          section={settingsSection}
          sidebarOpen={sidebarOpen}
          sidebarWidth={sidebarWidth}
          preferences={preferences}
          notifications={notifications}
          requestHeaders={requestHeaders}
          runtime={runtime}
          eventConnection={session.eventConnection}
          onOpenSidebar={() => setSidebarOpen(true)}
          onBack={leaveSettings}
          onSidebarWidthChange={setSidebarWidth}
          onPreferencesChange={updatePreferences}
          onClearArchivedSessions={session.deleteSessions}
        />
      ) : activeView === "packages" ? (
        <PackageManagerView
          cwd={managementCwd}
          sidebarOpen={sidebarOpen}
          ecosystem={ecosystem}
          onOpenSidebar={() => setSidebarOpen(true)}
          onBack={leaveEcosystem}
        />
      ) : activeView === "resources" ? (
        <ResourcesView
          cwd={managementCwd}
          sidebarOpen={sidebarOpen}
          ecosystem={ecosystem}
          onOpenSidebar={() => setSidebarOpen(true)}
          onBack={leaveEcosystem}
        />
      ) : (
      <main className="workspace-main">
        <header className="topbar">
          <div className="topbar-title-group">
            {!sidebarOpen && (
              <button
                className="icon-button sidebar-open-button"
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开侧边栏"
                title="打开侧边栏"
              >
                <Menu size={19} />
              </button>
            )}
            <div className="topbar-title">
              <span>{hasSession ? workspaceName : "Pi Desktop"}</span>
              <h1>{hasSession ? conversationTitle : "会话工作台"}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            {preferences.showRuntimeStatus && (
              <RuntimeStatusControl runtime={runtime} eventConnection={session.eventConnection} />
            )}
            {rightPanelEnabled && (
              <button
                ref={rightPanelTrigger}
                className="icon-button"
                type="button"
                aria-label={rightPanelVisibility.open ? "隐藏审查侧栏" : "显示审查侧栏"}
                aria-pressed={rightPanelVisibility.open}
                title={rightPanelVisibility.open ? "隐藏审查侧栏" : "显示审查侧栏"}
                onClick={rightPanelVisibility.togglePanel}
              >
                <PanelRight size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <section className="conversation-shell" aria-label="Pi 会话工作台">
          <div className="notice-stack">
            {runtimeMessage && (
              <div className="inline-alert" role="alert">
                <AlertTriangle size={17} />
                <span>{runtimeMessage}</span>
                <button type="button" onClick={() => void runtime.refresh()}>
                  <RefreshCw size={15} />
                  重新检测
                </button>
              </div>
            )}
            {eventChannelFailed && (
              <div className="inline-alert" role="alert">
                <AlertTriangle size={17} />
                <span>{session.error ?? "AGENT_EVENT_LISTEN_FAILED: 无法接收 Pi 事件"}</span>
                <button type="button" onClick={session.retryEventListener}>
                  <RefreshCw size={15} />
                  重新连接
                </button>
              </div>
            )}
            {session.catalogError && (
              <div className="inline-alert inline-alert-secondary" role="alert">
                <AlertTriangle size={17} />
                <span>{session.catalogError}</span>
                <button type="button" onClick={() => void session.loadCatalogs()}>
                  <RefreshCw size={15} />
                  重试同步
                </button>
              </div>
            )}
            {session.modelFallbackMessage && (
              <p className="inline-notice">{session.modelFallbackMessage}</p>
            )}
            {sessionError && !projectDialogOpen && (
              <p className="inline-alert inline-alert-text" role="alert">
                {sessionError}
              </p>
            )}
          </div>

          <div
            className="conversation-scroll"
            aria-label="会话消息"
            ref={conversationScroll}
            onScroll={(event) => {
              const target = event.currentTarget;
              const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 80;
              shouldStickToBottom.current = atBottom;
              setAtConversationBottom((current) => (current === atBottom ? current : atBottom));
            }}
          >
            <div className="thread-content-column-stack">
              <div className={`thread-body${hasSession && session.messages.length > 0 ? "" : " thread-body-empty"}`}>
                {session.phase === "creating" ? (
                  <div className="conversation-loading" role="status">
                    <LoaderCircle className="spin" size={24} />
                    <span>正在切换会话</span>
                  </div>
                ) : startupStage ? (
                  <StartupStatus stage={startupStage} />
                ) : !hasSession ? (
                  <EmptyWorkspace
                    loading={session.catalogPhase === "loading"}
                    hasSavedSessions={session.sessions.length > 0}
                    disabled={!runtimeReady || !eventChannelReady}
                    showSuggestions={preferences.showSuggestions}
                    onAddProject={openProjectDialog}
                    onNewConversation={() => void createConversation()}
                    onOpenSidebar={() => setSidebarOpen(true)}
                  />
                ) : session.messages.length === 0 ? (
                  <div className="empty-conversation">
                    <img className="empty-product-logo" src={appIconUrl} alt="" aria-hidden="true" />
                    <h2>开始对话</h2>
                    {preferences.showSuggestions && (
                      <p>
                        {session.cwd
                          ? `直接输入即可，Pi 会在 ${workspaceName} 的项目上下文中执行。`
                          : "直接输入即可开始对话。"}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <ConversationTimeline
                      messages={session.messages}
                      streaming={session.phase === "streaming"}
                      timer={session.timer}
                    />
                    <div ref={messagesEnd} />
                  </>
                )}
              </div>

              {hasSession && (
                <ChatComposer
                  workspaceName={workspaceName}
                  workspacePath={session.cwd}
                  recentWorkspaces={session.recentWorkspaces}
                  branchName={branchName}
                  draft={draft}
                  phase={session.phase}
                  eventConnection={session.eventConnection}
                  models={session.models}
                  configuration={session.configuration}
                  displayThinkingLevel={session.displayThinkingLevel}
                  configuring={session.configuring}
                  catalogPhase={session.catalogPhase}
                  catalogError={session.catalogError}
                  contextUsage={session.contextUsage}
                  attachments={attachments}
                  attachmentError={attachmentError}
                  canSend={canSend}
                  queuedMessages={session.queuedMessages}
                  queuePaused={session.queuePaused}
                  permissionMode={toolPermissions.mode}
                  availableTools={toolPermissions.availableTools}
                  selectedToolNames={toolPermissions.selectedToolNames}
                  defaultToolNames={toolPermissions.defaultToolNames}
                  slashCommands={slashCommands as ComposerCommand[]}
                  slashCommandsPhase={slashCommandsPhase}
                  slashCommandsError={slashCommandsError}
                  onDraftChange={setDraft}
                  onProjectChange={(cwd) => void createSession(cwd)}
                  onAddProject={openProjectDialog}
                  onAddFiles={() => void addFiles()}
                  onAddFolder={() => void addFolder()}
                  onPasteImages={(files) => void addPastedImages(files)}
                  onSearchWorkspacePaths={searchComposerPaths}
                  onAttachPath={(path) => addAttachments([path])}
                  onRemoveAttachment={(path) => {
                    setAttachments((current) => current.filter((item) => item !== path));
                    setPastedImagePaths((current) => current.filter((item) => item !== path));
                    setAttachmentError(null);
                  }}
                  onRetryModels={() => void session.loadCatalogs()}
                  onPrepareConfiguration={session.prepareConfiguration}
                  onModelChange={(provider, id) => void session.updateModel(provider, id)}
                  onThinkingLevelChange={(level) => void session.updateThinkingLevel(level)}
                  onUseDefaultTools={toolPermissions.useDefaultTools}
                  onToolSelectionChange={toolPermissions.setCustomTools}
                  onSend={sendPrompt}
                  onClearQueue={() => void session.clearQueue()}
                  onAbort={() => void session.abort()}
                />
              )}
              {hasSession && session.messages.length > 0 && !atConversationBottom && (
                <button
                  className="scroll-latest-button"
                  type="button"
                  aria-label="跳到最新消息"
                  title="跳到最新消息"
                  onClick={() => {
                    shouldStickToBottom.current = true;
                    setAtConversationBottom(true);
                    scheduleConversationScroll(preferredManualScrollBehavior(), true);
                  }}
                >
                  <ArrowDown size={16} />
                </button>
              )}
            </div>
          </div>
        </section>
      </main>
      )}

      {rightPanelVisibility.available && (
        <>
          {rightPanelVisibility.open && (
            <button
              className="right-panel-scrim"
              type="button"
              aria-label="关闭右侧面板遮罩"
              onClick={closeRightPanel}
            />
          )}
          <RightPanel
            open={rightPanelVisibility.open}
            available={rightPanelVisibility.available}
            opening={rightPanelVisibility.opening}
            closing={rightPanelVisibility.closing}
            width={rightPanelLayout.width}
            expanded={rightPanelLayout.expanded}
            activeTab={rightPanelTab}
            fileTab={fileTab ? { label: fileTab.name, title: fileTab.path } : null}
            previewTab={previewTab ? { label: previewTab.name, title: previewTab.path } : null}
            browserTab={browserTabOpen ? { label: "浏览器" } : null}
            onClose={closeRightPanel}
            onWidthChange={rightPanelLayout.setWidth}
            onExpandedChange={setRightPanelExpanded}
            onActiveTabChange={setRightPanelTab}
            onOpenFile={openRightPanelFileSearch}
            onOpenBrowser={openRightPanelBrowser}
            onCloseFileTab={closeRightPanelFile}
            onClosePreviewTab={closeRightPanelPreview}
            onCloseBrowserTab={closeRightPanelBrowser}
          >
            {rightPanelTab === "file" && fileTab ? (
              <FileViewer
                path={fileTab.path}
                rootPath={session.cwd}
                content={rightPanelFileState.targetPath === fileTab.path ? rightPanelFileState.content : ""}
                loading={rightPanelFileState.targetPath !== fileTab.path || rightPanelFileState.status === "loading"}
                error={rightPanelFileState.targetPath === fileTab.path ? rightPanelFileState.error : null}
                comments={commentsForFile(localCodeComments, fileTab.path)}
                onCreateComment={createRightPanelComment}
                onDeleteComment={deleteRightPanelComment}
                onRetry={() => setFileReloadKey((current) => current + 1)}
                onOpenExternal={openActiveRightPanelFile}
                onReveal={revealActiveRightPanelFile}
              />
            ) : rightPanelTab === "preview" && previewTab && previewTab.previewKind ? (
              <QuickPreview
                target={{
                  kind: previewTab.previewKind,
                  path: previewTab.path,
                  name: previewTab.name,
                  extension: previewTab.extension,
                  content: rightPanelFileState.targetPath === previewTab.path ? rightPanelFileState.content : "",
                }}
                dataBase64={rightPanelFileState.targetPath === previewTab.path ? rightPanelFileState.dataBase64 : ""}
                loading={rightPanelFileState.targetPath !== previewTab.path || rightPanelFileState.status === "loading"}
                error={rightPanelFileState.targetPath === previewTab.path ? rightPanelFileState.error : null}
                onOpenExternal={openActiveRightPanelFile}
                onReveal={revealActiveRightPanelFile}
                onRetry={() => setFileReloadKey((current) => current + 1)}
              />
            ) : rightPanelTab === "browser" ? (
              <BrowserSidebarPanel active={rightPanelVisibility.open} />
            ) : (
              <GitReviewPanel
                cwd={session.cwd}
                active={rightPanelVisibility.open && rightPanelTab === "review"}
                diffStyle={rightPanelLayout.diffStyle}
                displayOptions={rightPanelLayout.displayOptions}
                onDiffStyleChange={rightPanelLayout.setDiffStyle}
                onDisplayOptionToggle={rightPanelLayout.toggleDisplayOption}
              />
            )}
          </RightPanel>
          <FileSearchDialog
            open={fileSearchOpen}
            search={searchRightPanelFiles}
            onClose={() => setFileSearchOpen(false)}
            onOpenFile={openRightPanelFile}
          />
        </>
      )}

      {projectDialogOpen && (
        <ProjectDialog
          path={projectPath}
          creating={session.phase === "creating"}
          selecting={selectingProject}
          disabled={!runtimeReady || !eventChannelReady}
          error={projectSelectionError ?? sessionError}
          onSelectPath={() => void chooseProjectDirectory()}
          onSubmit={createProject}
          onClose={closeProjectDialog}
        />
      )}
    </div>
  );
}

interface StartupStatusProps {
  stage: "runtime" | "events";
}

function StartupStatus({ stage }: StartupStatusProps) {
  return (
    <div className="startup-status" role="status" aria-live="polite" aria-label="正在启动 Pi">
      <div className="startup-status-mark" aria-hidden="true">
        <img src={appIconUrl} alt="" />
        <span className="startup-status-spinner">
          <LoaderCircle className="spin" size={18} strokeWidth={2} />
        </span>
      </div>
      <h2>正在启动 Pi</h2>
      <p>{stage === "runtime" ? "正在连接本机 Pi 运行时" : "正在准备会话事件通道"}</p>
    </div>
  );
}

interface EmptyWorkspaceProps {
  loading: boolean;
  hasSavedSessions: boolean;
  disabled: boolean;
  showSuggestions: boolean;
  onAddProject: () => void;
  onNewConversation: () => void;
  onOpenSidebar: () => void;
}

function EmptyWorkspace({
  loading,
  hasSavedSessions,
  disabled,
  showSuggestions,
  onAddProject,
  onNewConversation,
  onOpenSidebar,
}: EmptyWorkspaceProps) {
  return (
    <div className="empty-workspace">
      {loading ? (
        <LoaderCircle className="spin" size={36} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <img className="empty-product-logo" src={appIconUrl} alt="" aria-hidden="true" />
      )}
      <h2>{hasSavedSessions ? "选择一个 Pi 会话" : "添加项目并开始会话"}</h2>
      {showSuggestions && (
        <p>
          {hasSavedSessions
            ? "从侧边栏继续已有工作，或为项目创建新会话。"
            : "项目会使用本机 Pi 配置，并保存在 Pi 的原生会话目录中。"}
        </p>
      )}
      <div className="empty-workspace-actions">
        <button className="secondary-button" type="button" onClick={onNewConversation} disabled={disabled}>
          <MessageSquarePlus size={16} />
          新建对话
        </button>
        {hasSavedSessions && (
          <button className="secondary-button" type="button" onClick={onOpenSidebar}>
            <MessageSquarePlus size={16} />
            查看会话
          </button>
        )}
        <button className="primary-button" type="button" onClick={onAddProject} disabled={disabled}>
          <FolderPlus size={16} />
          添加项目
        </button>
      </div>
    </div>
  );
}

interface ProjectDialogProps {
  path: string;
  creating: boolean;
  selecting: boolean;
  disabled: boolean;
  error: string | null;
  onSelectPath: () => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

function ProjectDialog({
  path,
  creating,
  selecting,
  disabled,
  error,
  onSelectPath,
  onSubmit,
  onClose,
}: ProjectDialogProps) {
  const canSubmit = !disabled && !creating && !selecting && path.trim().length > 0;

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !creating && !selecting) {
        onClose();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [creating, onClose, selecting]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="project-dialog-header">
          <div>
            <h2 id="project-dialog-title">添加项目</h2>
            <p>从资源管理器选择 Pi 可以访问的本机项目文件夹。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={creating || selecting}
            aria-label="关闭"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <span className="project-source-label">项目文件夹</span>
          <button
            className={`project-folder-picker${path ? " project-folder-picker-selected" : ""}`}
            type="button"
            onClick={onSelectPath}
            disabled={disabled || creating || selecting}
            aria-label={path ? "重新选择项目文件夹" : "选择项目文件夹"}
            autoFocus
          >
            {selecting ? (
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
            ) : path ? (
              <FolderOpen size={22} aria-hidden="true" />
            ) : (
              <FolderPlus size={22} aria-hidden="true" />
            )}
            <span className="project-folder-picker-copy">
              <strong>
                {selecting
                  ? "正在打开资源管理器"
                  : path
                    ? getWorkspaceName(path)
                    : "选择项目文件夹"}
              </strong>
              <small title={path || undefined}>
                {path || "使用系统文件夹选择器选择项目"}
              </small>
            </span>
          </button>
          {error && (
            <p className="project-dialog-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          <div className="project-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
              disabled={creating || selecting}
            >
              取消
            </button>
            <button className="primary-button" type="submit" disabled={!canSubmit}>
              {creating ? <LoaderCircle className="spin" size={15} /> : <FolderPlus size={15} />}
              {creating ? "正在添加" : "添加并创建会话"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getWorkspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "未绑定项目";
  }
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function requiresWorkspaceFileRead(target: RightPanelFileTarget): boolean {
  return target.tab === "file" ||
    target.previewKind !== "document" ||
    target.extension === "pdf" ||
    target.extension === "docx";
}

function isProjectWorkspace(cwd: string, conversationHome: string): boolean {
  const normalizedCwd = normalizeComparablePath(cwd);
  return normalizedCwd.length > 0 && normalizedCwd !== normalizeComparablePath(conversationHome);
}

function normalizeComparablePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function getRuntimeMessage(runtime: ReturnType<typeof useRuntimeStatus>): string | null {
  if (runtime.phase === "error") {
    return `RUNTIME_STATUS_FAILED: ${runtime.message}`;
  }
  if (runtime.phase === "ready" && runtime.status.status === "unavailable") {
    return `${runtime.status.error?.code ?? "RUNTIME_UNAVAILABLE"}: ${runtime.status.error?.message ?? "未找到可用 Pi 运行时"}`;
  }
  return null;
}

function formatProjectSelectionError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "PROJECT_DIRECTORY_SELECTION_FAILED: 无法打开资源管理器，请重试";
}

function formatAttachmentError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "CLIPBOARD_IMAGE_SAVE_FAILED: 无法保存剪贴板图片，请重试";
}

function formatCommandError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "COMMAND_LIST_FAILED: 无法读取当前命令，请稍后重试";
}

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 900;
}

function closeSidebarOnNarrowScreen(setOpen: (open: boolean) => void) {
  if (isNarrowViewport()) {
    setOpen(false);
  }
}

function readSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem("pi-desktop.sidebar-width"));
    if (Number.isFinite(stored) && stored >= 232 && stored <= 360) {
      return Math.round(stored);
    }
  } catch {
    // Fall through to the target product's default rail width.
  }
  return 300;
}

function scrollConversationToBottom(
  scrollElement: HTMLDivElement | null,
  endElement: HTMLDivElement | null,
  behavior: ScrollBehavior = "auto",
) {
  if (scrollElement?.scrollTo) {
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior });
    return;
  }
  endElement?.scrollIntoView?.({ block: "end", behavior });
}

function scheduleAfterLayout(callback: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timeout = window.setTimeout(callback, 16);
  return () => window.clearTimeout(timeout);
}

function preferredManualScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
