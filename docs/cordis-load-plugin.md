我来先找到 dsh 相关代码，再深入看它的插件加载机制。

看到 dsh 用了 `cordis.patch.yml`，说明插件体系可能基于 Cordis。先按规范读一下 `wework/AGENTS.md`，再看核心代码。

`wework/dsh` 下是构建产物（纯 JS + ESM），基于 `@deepseek-ai/cordis` 插件框架。我先读示例插件的完整实现，再去找 dsh 运行时的加载器源码。

示例插件结构已清楚：host 侧是 Cordis `apply(ctx)`，client 侧走 `window.__ModuleLoader__.load()`。现在去 dsh 源码仓（deepseek-harness）找加载器和打包机制。

浏览器侧的动态加载引擎已找到（`DynamicCordisPackageRunner`）。继续看求值器、客户端模块系统和 bundle 合并逻辑，把「TS 是否要打包」这条线补齐。

静态插件装载链路（profile → bundles → patch.yml → Loader entries）已经清楚。接下来看：① `dsh.client` 字段由谁消费（client 半边怎么进前端）；② 客户端模块系统；③ wework 插件中心的安装流程。

打包机制的关键文件已找到（`tsdown.client.ts`：client 半边 tsdown 打成 CJS 包，banner 包上 `__ModuleLoader__.load`）。再确认：① boot graph 怎么把插件 client.js 汇进来；② client 半边插件怎么被 apply。

找到了核心组装器：`packages/client/modules` 的 Node 半边负责扫描 Loader 里声明了 `dsh.client` 的包、合成 `__DSH_BOOT__` 并伺服 `/plugins/<id>/client.js`。继续读它的解析和连线逻辑。

静态链路已完整。补最后两块：wework 插件中心的安装入口，以及 agent 运行时动态定义插件（cordis-client-runner 的 host 半边）的执行方式。

调查完成。dsh 的插件加载有**两套并行的机制**——「安装型插件」(bundle) 和「运行时动态包」(dynamic package)，下面按你的两个核心问题展开。

## 总体架构：两条加载链路

**1. 安装型插件（wework 插件中心装的，需重启）**

dsh 基于 `@deepseek-ai/cordis` 插件框架（Koishi 同源），插件就是一个声明 `apply(ctx)` 的 npm 包。wework 桌面端的安装链路：

- UI 输入 `file:/abs/path` 或包名 → `installCoreDshPlugin(spec)`（`wework/src/features/dsh-plugins/coreDshPlugins.ts:22`）→ Electron 主进程 `CoreDshPluginManager.install()`（`wework/electron/src/runtime/core-dsh-plugin-manager.ts:103`）在 Core DSH 的 profile 目录（`$DSH_HOME/profiles/<name>`）里跑 **`pnpm add <spec>`**，然后把这个包写进 profile `package.json` 的 `dsh.profile.bundles` 列表（启停就是增删这个列表）。
- 重启 Core DSH 后，`loadProfile()`（deepseek-harness `packages/boot/app-boot/src/profile.ts:371`）按 bundles 顺序读出每个包 `package.json` 里 `dsh.bundle.patch` 指向的 `cordis.patch.yml`，逐层 apply 到空 entry 列表上，再叠上 profile 自己的用户 patch 层，得到最终 Loader entry 树。
- Node 侧由 Cordis Loader 逐个 **`import` 各插件的 node 半边**（`index.js`），执行其 `apply(ctx)`（例如 `electron-host/index.js` 里连 Electron、注册 HTTP 路由、`ctx.reflect.provide` 提供服务）。

**2. 客户端（浏览器）半边怎么被加载**

host 侧有一个专门的扫描器 `ClientModuleRegistry`（`packages/client/modules/src/index.ts`）：

- 增量监听 Cordis Loader 的每个 entry，读其包的 `dsh.client` 声明（要求 `platform: "web"`），解析 `exports["./client"]` 拿到构建好的 `client.js`；
- 把它伺服在 **`/plugins/<包名>/client.js?rev=<内容sha1>`** 路由上；
- 按模块依赖图排序合成 `window.__DSH_BOOT__` 引导图，连同 `window.__ModuleLoader__` 引导门面一起注入 index.html。
- 浏览器端 `AppWebEntry.run()`（`packages/client/web/src/boot.ts:46`）用这份图创建 `ClientModuleSystem`，再起一个**客户端的 Cordis Loader**，对每个插件行 `loader.create({name})` → `<script src>` 拉取 bundle → 脚本里的 `window.__ModuleLoader__.load({id, factory})` 注册 CJS 风格工厂 → `factory(require)` 的返回值就是客户端 cordis 插件 → 同一套 fiber/inject/apply 生命周期激活。`require` 只能解析「平台种子模块」（react、react-dom、cordis 等，见 `packages/client/web/src/platform.ts:8`）+ 其他已注册插件的模块表。
- wework 的 UI 扩展点就是在这个 `apply(ctx)` 里挂的：示例插件 `examples/ui-extension-demo/client.js` 用 `ctx.slots.inject('wework.route', …)` + `ctx.wework.ui.register(...)` 注册路由/侧边栏/设置页等。

**3. 运行时动态包（agent 用 `cordis_define` 写的，不落盘、不重启）**

`tool-cordis` 的 `cordis_define` 只做语法预检和注册（`packages/extensions/cordis-host-runner/src/sandbox.ts:212` 用 `new Function` 编译不执行）；`cordis_run` 时 host 半边在 **`node:vm` 沙箱**里以 `(async () => { code })()` 执行（`sandbox.ts:254`），沙箱封掉 `require/setTimeout/fetch` 并给出引导性报错，用 `harness.handle(method, fn)` 注册 RPC；client 半边的源码字符串被推到已打开的页面，`DynamicCordisPackageRunner.mount()`（`packages/extensions/cordis-client-runner/src/client/runtime.ts:343`）用 `new Function` 闭包求值（参数遮蔽注入 `React/console/styles/host`），同样注册进 `__ModuleLoader__` 并 `loader.create` 激活——注释原话："dynamic packages ride the exact machinery static plugins do"。卸载 = 删 loader entry → fiber dispose 级联回收 slot 注册和 style 标签。

## 问题一：TS 写的插件要不要打包？

**要，而且两个半边是两套构建产物**——但仅限安装型插件。共享构建预设是 `packages/client/tsdown.client.ts` 的 `clientBundle()`：

- **node 半边**：`tsc -b` + tsdown 编成 ESM（`lib/index.js`）。这是标准 npm 包契约——Node 里的 Cordis Loader 直接 `import` 磁盘上的 JS，所以 TS 必须预先编译，不能像 ts-node 那样即时跑。
- **client 半边**：`src/client/index.ts(x)` 由 tsdown/rolldown 打成**单文件 CJS bundle**（`lib/client.js`），构建时自动包上 banner/footer 变成 `window.__ModuleLoader__.load({ id, factory: (require) => {…} })` 的形状。关键规则：`PLATFORM_MODULES` 种子模块和包在 `dsh.client.external` 里声明的请求保持外部化（运行时由页面模块表 `require`），**其余依赖全部内联**；还有一个构建期"纯度门"禁止 import 未声明的 `@deepseek-ai/*` 包（跨插件协作必须走 cordis 服务）。CSS Modules 由 lightningcss 编译成运行时注入 `<style>` 标签；sourcemap 链回 TSX 源码。
- wework 自己的 `ui-*` 包和 `app-wework` 走的就是这个模式（`app-wework` 的 `web/` 目录来自 `build:dsh-app` 的 vite 静态组装，`client.js` 是插进 DSH slot 系统的客户端半边）。

**运行时动态包则相反：明确不支持打包和 TS**。两个半边都只能是纯 JS 源码字符串——报错文案写明 "The browser half is plain JavaScript (no JSX, no TypeScript); build elements with React.createElement"，TS 类型注解会触发专门的"去掉注解"教学提示（`sandbox.ts:184`），React 组件用 `createElement` 手写（示例 `client.js` 正是这么做的）。

## 问题二：plugin 怎么初始化/执行？

统一走 Cordis 的声明式生命周期，host/client 两侧对称：

1. 插件导出 `name`、`inject`（声明的服务依赖）、`apply(ctx, config)`；
2. `loader.create({name})` → import 模块 → 创建 fiber → **阻塞等待 `inject` 里声明的服务全部就绪** → 调用 `apply(ctx)`；`apply` 里通过 `ctx.provide`（提供服务）、`ctx.effect(fn, label)`（注册带清理的副作用）、`ctx.slots.inject`（UI 贡献）等挂载能力；
3. 停用/卸载 = 移除 loader entry → fiber dispose 自动级联清理所有 effect 和 slot 注册（动态包还会失效模块表工厂、删 style 标签，见 `runtime.ts:443` 的 `teardown`）；
4. 客户端插件的加载失败有完整的激活审计：boot 页显示每个 entry 的 pending/failed 状态和缺失的服务名（`boot.ts:137`）。

一个值得注意的细节：`dsh.client.inject` 在 wire 协议里只是**信息性元数据**（用于预检展示/HMR diff），真正约束加载顺序的是 `dsh.client.external`——因为 `require` 是同步的，被依赖包的 bundle 必须先到（`packages/client/modules/src/client/manifest.ts:46`）。
