# @chatdesk/desktop-plugin-sdk

`packages/desktop-plugin-sdk` 是 ChatDesk 桌面插件的公开契约：插件 manifest、UI 贡献 slot 的类型、插件上下文（`DesktopPluginContext`）与 `defineDesktopPlugin` 辅助函数。内置插件和外部插件都按这份契约向桌面宿主注册 UI；宿主侧的加载、校验与渲染在 `apps/desktop/src/lib/plugins/` 及其对应组件中。

## 内容

- `DESKTOP_PLUGIN_API_VERSION`：插件 API 版本（当前 `1`）。manifest 省略 `apiVersion` 视为当前版本，其他值会被拒绝，以便区分未来的格式。
- `DesktopPluginManifest` / `ExternalPluginManifest`：内置插件清单与外部插件 `plugin.json` 的形状；外部插件的 `id` 必须等于目录名。
- `DesktopPluginModule` / `ExternalPluginModuleExport`：插件入口在 `apply(ctx)` 中通过 `ctx.desktopUi.register(slot, contribution)` 注册贡献、`ctx.chatLayouts.register(id, component)` 注册聊天布局，用 `ctx.effect` 挂带清理的副作用。外部插件是 CommonJS 风格的 `index.js`，React 由宿主注入的 `require("react")` 提供，用 `React.createElement` 构建元素（不支持 JSX）。
- `DesktopContributionMap`：全部可贡献 slot 及其类型 —— 侧边栏导航、设置页、路由、工作区标签页（`workspace.tab`）、命令（`action`）、shell/sidebar 覆盖层、聊天页头部操作、输入框工具、消息区域前后与消息操作/meta、空状态、生成状态、状态栏、主题变量、聊天布局等。
- slot 列表（`DesktopUiSlot`）与 `@chatdesk/shared` 的 `DESKTOP_UI_SLOTS` 保持同步：新增或删除 slot 时要同时更新 shared 常量与宿主渲染，否则会被各处校验拒绝或渲染缺失。

## 边界

- 本包以类型与常量为主，`defineDesktopPlugin` 是唯一的运行时辅助函数；它不 import 宿主实现。
- `react`（>=19）是 peer dependency；工作区标签页的 scope 类型引用 `ai` 的 `UIMessage`。

## 开发与测试

在仓库根目录运行：

```sh
pnpm --filter @chatdesk/desktop-plugin-sdk test
pnpm --filter @chatdesk/desktop-plugin-sdk typecheck
```

## 相关文档

- [`docs/desktop-plugin-api.md`](../../docs/desktop-plugin-api.md)
- [`docs/cordis-load-plugin.md`](../../docs/cordis-load-plugin.md)
- [`docs/cordis-ui.md`](../../docs/cordis-ui.md)
