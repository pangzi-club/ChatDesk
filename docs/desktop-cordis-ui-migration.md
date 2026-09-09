# Desktop Cordis UI 迁移记录

> 本文是迁移过程记录。当前 API、slot 清单、插件加载/卸载行为和外部插件格式以
> [`desktop-plugin-api.md`](./desktop-plugin-api.md) 为准；本文件不再作为独立 API 规范维护。

本文记录 ChatDesk Desktop UI 从集中硬编码逐步迁移到同一个 Cordis `Context` 管理的
contribution 系统。核心宿主仍负责应用布局、权限、路由基础设施和业务状态；可选 UI 能力通过
类型安全的 slot 注册，并随 Cordis fiber 自动释放。

## 已完成的迁移范围

- 增加 `desktop.route`，集中注册 Channel、Automations 和 Image Generation 页面。前两者贡献
  Sidebar 与命令入口，Image Generation 保持隐藏导航。
- Router 保留 Chat、Settings 与历史兼容路由，其他页面由动态 Route Host 渲染；未知或已卸载的
  contribution 回退到 `/chat`。
- 增加 `desktop.workspace.tab`，以 `{ id, type, title, data }` 的判别联合替代包含大量可选字段的
  Workspace Tab。
- Workspace Tab 类型支持插件自定义字符串 id 与独立 data 类型；内置 Tab 继续从
  `WorkspaceTabDataMap` 自动推导，不需要把插件类型加入宿主联合。
- Workspace Tab contribution 提供图标、renderer、创建条件、创建函数和关闭清理；宿主继续管理
  标签顺序、激活状态、拖拽、窗口尺寸与分栏。
- 新建菜单和空窗口快捷入口共享可创建 contribution 清单。Explorer、Terminal、Browser 和 Side
  Chat 保持现有顺序与可用条件；Image、Plan、Context Detail 只由现有事件打开。
- Terminal 与 Side Chat 的资源释放走 contribution `onClose`，关闭单个、关闭全部和 runtime dispose
  使用同一路径；缺失 contribution 时显示可关闭的不可用占位。

## 应用内 Plugin API

Desktop 现在通过 `@chatdesk/desktop-plugin-sdk` 提供构建期插件入口；`apps/desktop/src/plugin-api.ts`
仅作为宿主兼容门面。插件导出带稳定 manifest 的
`DesktopPluginModule`，manifest 包含 `id`、`version`、`apiVersion`、`entry`、`contributes` 和
`permissions`。插件在共享 Cordis Context 中使用 `desktopUi` 与 `chatLayouts` service。启动时
插件可作为 `createDesktopUiRuntime(layout, plugins)` 的第二个参数传入，运行中也可通过
`runtime.installPlugin()` 安装并通过返回的 handle 或 `runtime.uninstallPlugin(name)` 卸载。

当前公开能力包括 `sidebar.navigation`、`route`、`settings.page`、`workspace.tab` 和 Chat layout。
内置 Desktop 插件统一位于 `apps/desktop/src/plugins/<id>/index.tsx`，manifest 可使用 `builtin: true` 标记；这类插件启动时默认加载并在插件目录中显示为内置，但不可安装或卸载。
插件名与 contribution id 必须全局唯一。安装失败会返回包含原始 `Error` 的失败结果并与其他插件
隔离；卸载会释放 Cordis fiber、`ctx.effect` 资源、UI contribution，以及属于被移除 Workspace Tab
contribution 的已打开实例。

这是应用内 TypeScript/JavaScript 模块 API，当前通过 `apiVersion: 1` 进行精确版本协商。当前本地开发
能力已包含对预定义 `apps/desktop/src/plugins` 的静态目录扫描、校验和插件管理页；扫描插件默认不启用，
只有用户点击安装才会启用并持久化 ID。外部插件目录已接入安装/卸载流程；升级、回滚、运行时下载代码、权限
隔离和签名校验仍保留到后续阶段。

## 历史阶段：命令与 Shell 扩展

- `desktop.action`：注册无页面的全局动作，并由命令菜单和快捷键调用宿主 action registry。
- `desktop.shell.overlay`、`desktop.shell.before/after`：承载状态横幅、通知与全局透明浮层。
- `desktop.sidebar.before/after/footer`：允许内置能力贡献 Sidebar 附加区域，Workspace 与会话列表仍
  属于宿主核心。

## 历史阶段：Chat 内部扩展

- `desktop.chat.header.action`：按 session/workspace scope 贡献 Chat Header 操作。
- `desktop.chat.composer.tool`：通过受控 props 与 callback 贡献 Composer 工具，不直接读取 Chat 私有
  React 状态。

## 约束与验收

- contribution 协议通过 Desktop 的 `plugin-api.ts` 提供应用内入口，不导出到 `packages/shared`，不承诺第三方 ABI。
- 所有注册使用稳定全局 ID、`order + 注册顺序` 排序，并通过 `ctx.effect` 托管释放。
- 保持现有视觉、URL、快捷键、Browser 导航、Plan/Context 更新、Side Chat 草稿和 Explorer/Git 行为。
- 每阶段运行 `pnpm format`、`pnpm check`、`pnpm test` 和 `pnpm build`。UI 验收只复用已经运行的
  Electron 实例，不另行启动应用。
