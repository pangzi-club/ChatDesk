---
sidebar_position: 35
---

# 使用 Cordis 自定义 Wework UI（历史文档）

> 本文针对旧版 Wework/DSH，不是当前 ChatDesk Desktop Plugin API。当前实现请参阅
> [`desktop-plugin-api.md`](./desktop-plugin-api.md)。

本文介绍如何通过 Cordis/DSH 为 Wework 桌面端添加应用、路由、设置页、侧边栏入口和工作区面板。Wework UI 只使用 Core DSH 作为插件运行时；插件不需要、也不应创建 Wework 私有 manifest、动态模块加载器或第二个 Cordis `Context`。

## 工作原理

Core DSH 启动后为插件创建一个 Cordis `Context`。`@wegent/dsh-app-wework` 在这个 Context 中提供 `wework` service，并声明一组 UI slots。其他插件通过 `ctx.slots.inject` 等待 slot 存活，再调用 `ctx.wework.ui.register` 注册贡献。

```text
Cordis Context
  ├─ wework service
  ├─ wework.app / wework.route / wework.settings.page ...
  └─ 第三方插件贡献
       └─ React component + descriptor
```

Slot 的发现、排序、渲染和释放由 DSH 管理。插件卸载、宿主重建或 Context 销毁时，注册项会随生命周期自动清理。

## 为什么使用 Slot

Slot 是带有名称、元数据、排序、订阅和生命周期管理能力的 UI 扩展协议。它不是一个 DOM 节点，也不只是 React 的 `children`。宿主先声明可以扩展的位置，插件再向这些位置贡献描述信息或 React 组件。

例如，直接添加“质量看板”通常需要分别修改侧边栏、路由配置和页面容器，并手动处理注册和清理。使用 Slot 后，插件可以在自己的代码中集中注册导航和页面，而不修改宿主内部实现。

使用 Slot 的主要收益包括：

1. **降低耦合**：插件只依赖公开的 Slot 名称、descriptor 和组件 props，不需要 import Wework 内部组件。宿主重构内部目录或实现时，只要 Slot 契约不变，插件通常无需修改。
2. **支持独立管理**：插件可以单独安装、启用、停用、更新和卸载。卸载后，其导航、路由和组件贡献会一起消失。
3. **统一生命周期**：`ctx.slots.inject` 让注册跟随目标 Slot 和插件 Context。宿主重建、Slot 消失或插件卸载时，相关贡献会自动释放，避免重复注册和遗漏清理。
4. **避免集中硬编码**：宿主不需要维护包含所有插件页面和导航的大型配置。每个插件独立声明贡献，宿主只负责汇总、排序和渲染。
5. **允许多方扩展**：多个插件可以同时向一个 Slot 注册内容，并使用 `order`、`priority` 等通用字段统一排序。
6. **形成明确边界**：插件只能通过宿主公开的扩展点影响 UI，不应直接操作宿主 DOM、修改内部路由表或读取私有 React Context。
7. **便于第三方开发**：第三方开发者只需要理解公开协议，无需掌握整个 Wework 源码，也不需要为每个功能修改和重新发布宿主。

Slot 并不替代所有直接实现。选择原则是：**核心骨架直接实现，可选能力通过 Slot 扩展。**

适合使用 Slot 的场景：

- 可选、可插拔或第三方功能。
- 多个模块都会贡献内容的区域。
- 需要独立安装、启停、更新或卸载的功能。
- 应用、路由、导航、设置页、工具面板和工作区 Tab 等扩展点。

适合直接写在宿主中的场景：

- 应用启动流程和整体页面布局。
- 权限控制、安全边界和核心状态管理。
- 所有安装都必须具备的基础能力。
- 对性能、渲染顺序或跨模块一致性有严格要求的底层逻辑。

## 插件最小结构

```text
my-wework-plugin/
├── package.json
├── cordis.patch.yml
├── index.js          # Host 入口；纯 UI 插件可以为空
└── client.js         # 浏览器入口
```

`package.json` 至少声明 bundle patch 和浏览器端依赖：

```json
{
  "name": "@example/wework-quality-dashboard",
  "type": "module",
  "main": "index.js",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@wegent/dsh-app-wework"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2"
  }
}
```

`cordis.patch.yml` 将插件插入 DSH Loader 树：

```yaml
- insert:
    - id: quality-dashboard
      name: '@example/wework-quality-dashboard'
```

纯 UI 插件的 `index.js` 只需提供一个空的 Host 插件入口：

```js
export const name = 'quality-dashboard'

export function apply() {}
```

## 注册 UI

DSH 浏览器模块使用 `window.__ModuleLoader__.load` 注册。下面是完整的 `client.js`，它同时添加一个侧边栏入口和对应页面：

```js
window.__ModuleLoader__.load({
  id: '@example/wework-quality-dashboard',
  factory: require => {
    const React = require('react')

    function QualityDashboard({ search }) {
      return React.createElement(
        'main',
        {
          'data-testid': 'quality-dashboard',
          style: { height: '100%', overflow: 'auto', padding: '24px' },
        },
        React.createElement('h1', null, '质量看板'),
        React.createElement('p', null, `查询参数：${search || '无'}`)
      )
    }

    return {
      inject: ['slots', 'wework'],
      apply(ctx) {
        ctx.slots.inject('wework.route', () =>
          ctx.wework.ui.register(
            ctx,
            'wework.route',
            {
              id: 'quality-dashboard.route',
              path: '/quality-dashboard',
              icon: 'shield-check',
              title: '质量看板',
              telemetryFeature: 'apps',
              restorePolicy: 'session',
            },
            QualityDashboard
          )
        )

        ctx.slots.inject('wework.sidebar.navigation', () =>
          ctx.wework.ui.register(ctx, 'wework.sidebar.navigation', {
            id: 'quality-dashboard.navigation',
            activeItem: 'quality-dashboard',
            path: '/quality-dashboard',
            icon: 'shield-check',
            label: '质量看板',
            order: 50,
            testId: 'quality-dashboard-navigation',
          })
        )
      },
    }
  },
})
```

`ctx.wework.ui.register` 会把 Wework descriptor 附加到组件，再交给 `ctx.slots.register`。因此不要直接把 Wework 专用字段塞进 Cordis slot options，也不要绕过 `ctx.slots.inject` 直接注册到尚未挂载的 slot。

## 可用 Slot

| Slot | 用途 | 组件 props |
| --- | --- | --- |
| `wework.action` | 由宿主执行的路径动作 | 无组件 |
| `wework.app` | 应用切换器和应用 surface | `visible`, `tab` |
| `wework.route` | 顶层页面 | `search`, `onNavigate` |
| `wework.sidebar.navigation` | 左侧导航 | 通常无组件 |
| `wework.settings.page` | 设置导航和设置内容 | 设置上下文、`onBack` |
| `wework.workspace.tab` | 顶部可关闭工作区 Tab | `visible`, `tab` |
| `wework.workspace.sidebar.tab` | 右侧工作区面板 Tab | `visible`, `scope`, `tab` |
| `wework.shell.before/after` | 工作台根节点前后 | 空对象 |
| `wework.shell.overlay` | 全局浮层（应透明传递指针） | 空对象 |

### 应用模式

`wework.app` 的 `mode` 有三种：

- `native`：导航到 `path`，由 Wework 原生工作区渲染。
- `iframe`：在应用 WebView 中打开 `url`。
- `surface`：在 `/app/<id>` 中渲染插件提供的 React 组件。

### Descriptor 约束

- 每个贡献使用全局唯一的 `id`。
- `wework.action` 只描述 `{ id, path }`，不要放函数、token 或不可序列化状态。
- 第三方 `wework.route` 和 `wework.settings.page` 不要设置内部 `module` 或 `component` 字段；组件作为 `register` 的第四个参数传入。
- `icon` 使用 Lucide 图标名称（kebab-case），例如 `rocket`、`shield-check`；无效名称会回退到默认图标。
- 所有新交互元素提供稳定的 `data-testid`。

## 生命周期和服务

如果插件还包含定时器、订阅或连接，应使用 `ctx.effect` 注册并返回清理函数。不要在模块顶层创建长生命周期资源：

```js
apply(ctx) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      // Refresh plugin state.
    }, 30_000)
    return () => clearInterval(timer)
  }, 'quality-dashboard: refresh timer')
}
```

标准 DSH service（如 `sessions`、`tools`）通过 `inject` 获取。第一方 Electron capability 由 `@wegent/dsh-electron-host` 暴露；第三方插件不要直接依赖 Electron 对象、IPC 或鉴权 token。

如果需要标准 service，把它加入插件导出的 `inject`，随后从 `ctx` 读取：

```js
return {
  inject: ['slots', 'wework', 'sessions'],
  apply(ctx) {
    const sessions = ctx.sessions
    // Register UI that consumes the sessions service.
  },
}
```

## 安装和生效

将上述四个文件放在同一插件目录后，在 Wework 的插件管理界面输入该目录的绝对路径，或使用以下形式：

```text
file:/absolute/path/to/my-wework-plugin
```

安装过程会读取 `package.json` 中的 `dsh.bundle.patch`，用 `cordis.patch.yml` 合并 Loader 配置，并校验最终 DSH profile。配置变化后需要重启 Core DSH；插件不应假设安装、启停或更新后可以立即热生效。

## 验证流程

1. 安装插件并重启 Core DSH，确认侧边栏出现“质量看板”。
2. 点击入口，确认 URL 进入 `/quality-dashboard` 且页面正常渲染。
3. 携带查询参数打开页面，确认组件收到正确的 `search`。
4. 停用插件并重启，确认导航和页面贡献同时消失。
5. 再次启用并重启，确认贡献恢复且没有重复注册。
6. 卸载插件并重启，确认 UI 和插件资源均不再加载。
7. 制造无效 patch 或缺失依赖，确认安装预检失败且原 profile 可以恢复。

## 完整检查清单

- `package.json` 中的包名与 `client.js` 的 ModuleLoader `id` 一致。
- `cordis.patch.yml` 中的 `name` 与包名一致，Loader `id` 唯一。
- 浏览器插件声明 `inject: ['slots', 'wework']`。
- 所有 UI 都通过 `ctx.slots.inject` 和 `ctx.wework.ui.register` 注册。
- 每个 contribution `id` 全局唯一，交互元素有稳定的 `data-testid`。
- 第三方页面直接传入 React 组件，不使用内部 `module` 或 `component` 字段。
- 定时器、订阅和连接由 `ctx.effect` 清理。
- 插件安装、停用、启用、更新和卸载后均通过重启 Core DSH 验证。
