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
state。Composer tool 应通过宿主提供的 `insertText` 修改输入内容。

阶段一仅支持构建期可导入模块，不支持目录扫描、远程代码、本地 `manifest.json`、权限沙箱或动态
外部安装。`apiVersion` 提供带版本号的兼容协商，但不承诺跨宿主版本永久 ABI。插件不得创建第二个
Desktop Cordis Context。
