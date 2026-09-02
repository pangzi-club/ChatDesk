# 用 Cordis 在运行时替换 React Layout

这个独立教程演示一个更适合 Cordis 的 React 场景：应用只渲染一个稳定的 `App`，但运行时可以卸载当前 Layout 插件、加载另一个 Layout 插件，React 不需要修改调用方代码。

最终效果是：点击按钮后，页面可以在默认布局和紧凑布局之间切换。Layout 的注册、替换和清理由 Cordis 管理；React 只消费当前 Layout。

## 1. 创建项目

需要 Node.js 22 或更高版本。创建 Vite React TypeScript 项目并安装依赖：

```sh
npm create vite@latest cordis-layout-demo -- --template react-ts
cd cordis-layout-demo
npm install
npm install cordis
```

删除 `src/App.tsx` 和 `src/main.tsx` 的内容，按下面的文件重建示例。

## 2. 定义 Layout 服务

创建 `src/layout-service.ts`：

```tsx
import { Service, type Context } from 'cordis'
import type { ComponentType, ReactNode } from 'react'

export interface LayoutProps {
  title: string
  children: ReactNode
}

export type LayoutComponent = ComponentType<LayoutProps>

declare module 'cordis' {
  interface Context {
    layouts: LayoutService
  }
}

export class LayoutService extends Service {
  private readonly definitions = new Map<string, LayoutComponent>()
  private readonly listeners = new Set<() => void>()
  private activeId = ''
  private snapshot: { id: string; component: LayoutComponent | undefined } = { id: '', component: undefined }

  constructor(ctx: Context) {
    super(ctx, 'layouts')
  }

  register(id: string, component: LayoutComponent) {
    if (this.definitions.has(id)) throw new Error(`layout already registered: ${id}`)
    this.definitions.set(id, component)
    if (!this.activeId) this.activeId = id
    this.refreshSnapshot()
    this.notify()
    return () => {
      this.definitions.delete(id)
      if (this.activeId === id) this.activeId = this.definitions.keys().next().value ?? ''
      this.refreshSnapshot()
      this.notify()
    }
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  activate(id: string) {
    if (!this.definitions.has(id)) throw new Error(`unknown layout: ${id}`)
    this.activeId = id
    this.refreshSnapshot()
    this.notify()
  }

  private refreshSnapshot() {
    this.snapshot = { id: this.activeId, component: this.definitions.get(this.activeId) }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}
```

这里的服务保存 Layout 注册表，并提供 `register()`、`activate()` 和 React 所需的 `subscribe()`/`getSnapshot()`。`register()` 返回 disposer，所以卸载插件时，Layout 会从注册表中移除。服务不保存 JSX 实例，只保存组件类型和当前 id。

## 3. 编写两个 Layout 插件

创建 `src/default-layout.tsx`：

```tsx
import type { Context } from 'cordis'
import type { LayoutProps } from './layout-service'

export const name = 'default-layout'
export const inject = ['layouts']

export function apply(ctx: Context) {
  return ctx.layouts.register('default', ({ title, children }: LayoutProps) => (
    <div className="default-layout">
      <header>{title}</header>
      <section>{children}</section>
    </div>
  ))
}
```

创建 `src/compact-layout.tsx`：

```tsx
import type { Context } from 'cordis'
import type { LayoutProps } from './layout-service'

export const name = 'compact-layout'
export const inject = ['layouts']

export function apply(ctx: Context) {
  return ctx.layouts.register('compact', ({ title, children }: LayoutProps) => (
    <div className="compact-layout">
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  ))
}
```

这两个插件都依赖同一个 `layouts` 服务，但互相不知道对方存在。它们只负责提供 Layout。以后增加移动端、只读模式或品牌主题，只需要增加新的插件。

## 4. 让 React 消费当前 Layout

创建 `src/App.tsx`：

```tsx
import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'

export function App({ ctx, replaceLayout }: { ctx: Context; replaceLayout: (id: 'default' | 'compact') => void }) {
  const { id, component: Layout } = useSyncExternalStore(
    ctx.layouts.subscribe,
    ctx.layouts.getSnapshot,
  )

  if (!Layout) return <p>没有可用的 Layout（当前 id：{id || 'none'}）</p>

  return (
    <Layout title="订单中心">
      <p>这里是业务内容。切换 Layout 时，这段内容不会改变。</p>
      <div className="actions">
        <button onClick={() => replaceLayout('default')}>默认布局</button>
        <button onClick={() => replaceLayout('compact')}>紧凑布局</button>
      </div>
    </Layout>
  )
}
```

`App` 只依赖 `LayoutService` 的公开能力，不依赖具体 Layout 插件。React 收到新的快照后，会用新的组件类型重新渲染整个 Layout；业务内容仍然由同一个 `App` 传入。

## 5. 启动、卸载和替换插件

创建 `src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from 'cordis'
import { LayoutService } from './layout-service'
import { apply as applyDefault } from './default-layout'
import { App } from './App'
import './index.css'

const ctx = new Context()
await ctx.plugin(LayoutService)
let current = await ctx.plugin(applyDefault)

async function replaceLayout(id: 'default' | 'compact') {
  await current.dispose()
  const module = await import(id === 'default' ? './default-layout' : './compact-layout')
  current = await ctx.plugin(module.apply)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App ctx={ctx} replaceLayout={(id) => { void replaceLayout(id) }} /></StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.dispose(() => { void ctx.fiber.dispose() })
}
```

运行：

```sh
npm run dev
```

调用 `replaceLayout('compact')` 时，旧插件先卸载并移除注册项，新插件再注册自己的 Layout。React 组件仍然只读取 `ctx.layouts`，无需知道替换过程。`import()` 让每个 Layout 的代码也可以按需加载；实际项目可以把这个 id 到模块的映射放到 Cordis Loader 配置中。

## 6. 什么时候 Cordis 才有价值

如果只有一个 Layout，直接使用 React 组件或路由就足够，Cordis 会增加复杂度。这个模式在以下情况才值得使用：

- Layout 来自可安装、可卸载的插件。
- 不同部署环境需要加载不同的 UI 组合。
- Layout 带有需要一起清理的订阅、快捷键、遥测或外部资源。
- 需要在运行时切换实现，并让其他插件通过服务或事件观察切换。

不要让插件直接调用 React 的 `setState`，也不要把插件实例写进全局变量。让 Cordis fiber 拥有注册和清理，让 React 订阅服务快照；这就是动态替换能够保持可控的关键。
