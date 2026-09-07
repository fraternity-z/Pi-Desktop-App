import type { ToolPermissionState } from "../stores/useToolPermissions";
import { SettingsRow, SettingsSection, SettingsSelect, SettingsToggle } from "./SettingsControls";

export function AgentConfigurationSettings({ tools }: { tools?: ToolPermissionState }) {
  const catalog = tools?.availableTools ?? [];
  return (
    <>
      <SettingsSection label="工具操作">
        <SettingsRow
          title="工具选择"
          description="与聊天框的工具选择同步，在下一次发送消息时生效。"
          control={
            <SettingsSelect
              label="工具选择模式"
              value={tools?.mode ?? "default"}
              disabled={!tools || catalog.length === 0}
              options={[
                { value: "default", label: "Pi 默认" },
                { value: "custom", label: "自定义" },
              ]}
              onChange={(mode) =>
                mode === "default"
                  ? tools?.useDefaultTools()
                  : tools?.setCustomTools(tools.selectedToolNames)
              }
            />
          }
          last={catalog.length === 0}
        />
        {catalog.map((tool, index) => (
          <SettingsRow
            key={tool.name}
            title={tool.name}
            description={tool.description}
            control={
              <SettingsToggle
                label={`允许 ${tool.name}`}
                checked={tools!.selectedToolNames.includes(tool.name)}
                onChange={(allowed) =>
                  tools!.setCustomTools(
                    allowed
                      ? [...tools!.selectedToolNames, tool.name]
                      : tools!.selectedToolNames.filter((name) => name !== tool.name),
                  )
                }
              />
            }
            last={index === catalog.length - 1}
          />
        ))}
      </SettingsSection>
      <p className="settings-row-description prompt-scope-note">
        {catalog.length === 0
          ? "尚无工具清单，请先创建或打开 Pi 会话。"
          : `已允许 ${tools!.selectedToolNames.length} / ${catalog.length} 个工具；关闭的工具不会提供给模型。`}
        工具启停不等于系统权限隔离；bash 和扩展仍可能访问文件及网络。
      </p>
      <SettingsSection label="权限与隔离">
        {[
          ["操作审批策略", "Pi 未提供统一的内置审批配置；扩展可以实现工具调用拦截。"],
          ["文件访问与沙箱", "Pi 未提供内置的工作区读写沙箱配置；需要扩展或外部隔离环境。"],
          ["网络访问", "Pi 未提供统一的工具网络允许或禁止配置。"],
          ["网页搜索", "Pi 未提供内置网页搜索权限配置；取决于所安装的工具与扩展。"],
        ].map(([title, description], index) => (
          <SettingsRow
            key={title}
            title={title!}
            description={description}
            control={<span className="settings-value">暂无内置配置链路</span>}
            last={index === 3}
          />
        ))}
      </SettingsSection>
    </>
  );
}
