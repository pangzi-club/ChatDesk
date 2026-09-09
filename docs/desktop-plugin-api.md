# Desktop Plugin API

Desktop Plugin API 允许随应用一起构建的模块向共享 Cordis Context 注册 UI。插件只从
`apps/desktop/src/plugin-api.ts` 导入公开类型和 service，不依赖宿主内部路由表、React Context 或
Electron 对象。

```tsx
import type { DesktopPluginModule, WorkspaceTabContribution } from "@chatdesk/desktop-plugin-sdk";
import { Rocket } from "lucide-react";

function ExamplePage() {
  return <main>Example</main>;
}

export const plugin = {
  manifest: {
    id: "example.dashboard",
    version: "1.0.0",
    apiVersion: 1,
    entry: "example/dashboard",
    contributes: ["route"],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(() =>
      ctx.desktopUi.register("route", {
        id: "example.dashboard.route",
        path: "/example-dashboard",
        title: "Example dashboard",
        icon: Rocket,
        keywords: ["example", "dashboard"],
        navigation: { label: "Example", section: "secondary" },
        component: ExamplePage,
      }),
    );
  },
} satisfies DesktopPluginModule;
```

第三方插件唯一从 `@chatdesk/desktop-plugin-sdk` 导入公开契约；`@/plugin-api` 只是宿主兼容门面，不能作为
第三方依赖。`manifest.id` 是插件的全局稳定标识，`version` 使用 `major.minor.patch` 格式，`entry` 是构建期入口
标识。宿主当前只接受 `apiVersion: 1`；`contributes` 必须是公开 slot 且不能重复，首版
`permissions` 必须为空数组。Manifest 在创建 Cordis fiber 前校验，失败插件不会执行 `apply`。
内置插件可设置 `builtin: true`；这类插件由 Desktop 启动时默认加载，插件目录中显示为“内置”，且不能安装或卸载，启用状态不依赖持久化插件列表。

## 加载和卸载

将插件随启动参数传入，可保证 contribution 在首次渲染前可用：

```ts
const runtime = await createDesktopUiRuntime(layout, [plugin]);
```

运行时安装使用 `runtime.installPlugin(plugin)`。该方法返回 `{ ok: true, handle }` 或
`{ ok: false, error }`，不会因一个插件失败而停止其他插件。成功结果的 `handle.dispose()` 和
`runtime.uninstallPlugin(plugin.name)` 都会释放插件；重复调用不会重复清理。`runtime.pluginResults`
包含启动阶段所有默认与调用方插件的安装结果，可用于诊断。

插件应把订阅、计时器和 contribution 注册放进 `ctx.effect`，并由清理函数释放。卸载 Workspace Tab
contribution 时，宿主会对该类型的已打开 Tab 调用 `onClose`，以释放终端或会话等资源。

## 公开能力和约束

- `sidebar.navigation`：侧边栏入口。
- `route`：顶层页面及可选导航入口。
- `settings.page`：设置页面、搜索关键词与布局元数据。
- `workspace.tab`：Tab renderer、创建条件、创建及关闭行为。
- `action`：无页面动作，可进入 Command Menu 并绑定全局快捷键。
- `shell.overlay`、`shell.before/after`：应用级状态、内容和浮层。
- `sidebar.before/after/footer`：Sidebar 附加区域。
- `chat.header.action`：使用只读对话 scope 渲染 Chat Header 操作。
- `chat.composer.tool`：使用受控 value、`insertText` 和 `focus` 回调扩展 Composer 工具栏。
- `chat.messages.before` / `chat.messages.after`：使用只读对话 scope 在消息列表上方/末尾插入内容。
- `chat.composer.float`：使用只读对话 scope 在 Composer 上方浮层区（Git 摘要、待办面板旁）提供内容。
- `chat.message.action`：在每条消息的操作行渲染插件按钮，scope 为只读对话 scope 加上 `message`
  （`id`、`role`、`text`），插件不得修改消息或读取 Chat 页面内部 React state。
- `chatLayouts`：注册和激活 Chat layout。

插件名和每个 contribution id 都必须全局唯一；重复项返回或抛出明确错误，不会覆盖旧注册。排序继续
使用 `order`，相同顺序按注册先后排列。

自定义 Workspace Tab 使用 contribution 的两个泛型参数声明稳定的类型 id 和 data：

```tsx
type InspectorData = { resourceId: string };

const inspector = {
  id: "example.inspector",
  label: "Inspector",
  icon: Rocket,
  create: () => ({
    id: crypto.randomUUID(),
    type: "example.inspector",
    title: "Inspector",
    data: { resourceId: "current" },
  }),
  renderer: ({ tab }) => <main>{tab.data.resourceId}</main>,
} satisfies WorkspaceTabContribution<"example.inspector", InspectorData>;
```

内置 Tab 仍通过 `WorkspaceTabDataMap` 自动推导 data；插件自定义 Tab 不需要修改该内置映射。

`action.run` 接收当前 `pathname` 和受控 `navigate`。声明 `shortcut` 后宿主会在全局键盘处理器中执行
动作；宿主核心快捷键优先，插件之间发生冲突时按 contribution 排序选择第一个动作。Chat
contribution 只接收 session、workspace、cwd、生成状态和只读状态，不应读取 Chat 页面内部 React
state。`chat.message.action` 额外接收只读的消息 `id`、`role` 和 `text`。Composer tool 应通过宿主提供的
`insertText` 修改输入内容。

阶段一支持扫描构建期预定义目录 `apps/desktop/src/plugins`：入口由静态 glob 注册表映射，必须与
`manifest.entry` 一致；未知插件默认禁用，安装即启用、卸载即禁用。桌面设置只持久化成功安装的
插件 ID，重启时仅恢复仍然有效的 ID。扫描不会执行 `apply`，非法 manifest、越界/重复入口和重复 ID
会显示为不可用。外部插件目录已支持，但属于可信代码边界；当前仍不支持远程代码、动态下载、权限沙箱或签名校验。

## 外部插件（Cordis 动态加载）

桌面端还支持从 `~/.chatdesk/plugins`（以及 Plugins 页添加的目录）扫描纯 JavaScript 插件。每个插件目录包含
`plugin.json` 与 `index.js`；manifest 的 `id` 必须与目录名一致，`apiVersion` 为 `1`，`contributes` 只能使用公开
slot，`permissions` 必须为空数组。入口使用 CommonJS 风格导出 `{ inject?, apply(ctx) }`，可通过宿主注入的
`require("react")` 使用 React 单例并用 `React.createElement` 编写组件。

扫描阶段只读取文件并用 `new Function` 做语法编译预检，不执行未安装插件。用户点击安装后，入口才在页面进程中求值，
随后进入与内置插件相同的 Cordis fiber、`ctx.effect` 和卸载清理流程。外部插件属于可信代码边界；当前没有权限沙箱，
请只安装可信来源。已安装插件在启动时恢复，扫描到的新版本需先卸载再安装才能生效。

## 能力评估与后续优先级

当前 API 已经足够支撑“构建期的桌面 UI 插件”：导航、顶层路由、设置页、Workspace Tab、命令与
快捷键、Shell/Sidebar 附加区域、Chat Header/Composer 工具、Chat 消息区前后置/输入区浮层/消息操作，
以及 Chat layout 都可以通过公开 slot
注册。结合 `ctx.effect`、稳定 ID、排序、安装/卸载和 Tab `onClose`，内置功能模块化和常规 UI 扩展已经
具备可用的生命周期基础。

但它还不是完整的开放式插件平台。当前插件 Context 只有 UI 注册和 effect，缺少 storage、通知、dialog、
session/chat 操作、workspace、Server API、文件系统和 Electron 能力；Chat scope 也不能扩展消息渲染、
发送流程、工具调用或模型选择。`permissions` 暂时只能是空数组，插件加载仍限于构建期静态入口，因此
第三方插件可以做丰富的 UI，但还不能稳定地做深度业务集成或安全运行不可信代码。

后续工作按优先级分为：

### P0：先建立可持续的插件基础能力

- 增加版本化的 capability/service 合约，优先覆盖 `storage`、`notifications`、`dialogs`、`commands`、
  `sessions/chat`、`workspace` 和 `serverClient`。
- 将权限从 `readonly []` 演进为可校验的 capability 声明，并让宿主按权限注入服务；没有授权时服务不可用。
- 统一 `packages/desktop-plugin-sdk` 与 `apps/desktop/src/plugin-api.ts` 的公开类型来源，避免两套类型
  漂移；同时明确 SDK 的发布边界和 `apiVersion` 兼容策略。
- 为插件渲染增加错误边界、失败隔离和诊断信息，避免单个插件破坏整个 App Shell。

### P1：补齐高价值 UI 扩展面

- Chat 消息渲染替换、发送流程扩展（消息操作与消息区前后置/输入区浮层 slot 已提供）。
- Workspace Tab toolbar、context menu、status bar，以及 Explorer/editor 扩展。
- Modal/panel、通知中心等需要宿主协调状态的 UI surface。
- 对高频扩展抽象通用 contribution 元数据，避免仅靠不断增加字符串 slot 导致协议碎片化。

### P2：开放第三方生态与安全运行

- 支持用户插件目录、动态安装、升级、回滚和依赖管理。
- 增加插件包签名/完整性校验、权限审核和兼容性检查。
- 在需要运行不可信第三方代码时提供隔离边界（独立进程或受限沙箱），并明确 Electron、文件系统和网络
  能力的安全策略。

因此，当前版本可以定义为“UI contribution SDK”；完成 P0 后才适合承诺“可扩展业务插件 SDK”，完成
P2 后再考虑面向不可信第三方的开放插件市场。
