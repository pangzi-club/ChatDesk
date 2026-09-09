---
name: plugin-creator
description: 创建 ChatDesk 外部插件。当用户说“加一个页面”“做个插件”“做贪吃蛇”等需要扩展桌面端功能时使用。
---

# ChatDesk 插件创建

先确认插件功能和名称，再使用 `create_plugin` 创建纯 JavaScript 插件。默认页面插件使用 `route` 与 `sidebar.navigation` 扩展点，组件用 `require("react")` 和 `React.createElement`，不要输出 TS/JSX。

创建成功后告诉用户打开 Plugins 页面并点击“重新扫描”，然后安装插件。外部插件在页面进程内运行，只为可信代码使用。

完整契约和模板见 `references/format.md`。
