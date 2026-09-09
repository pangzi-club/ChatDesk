# 外部插件格式

目录为 `~/.chatdesk/plugins/<id>/`，包含 `plugin.json` 与 `index.js`。manifest 必须包含 `id`、`name`、`description`、`version`、`apiVersion: 1`、`entry: "index.js"`、`contributes` 和空 `permissions`。入口导出 `{ inject?, apply(ctx) }`。

```js
const React = require("react");
function Page() { return React.createElement("main", null, "Hello"); }
module.exports = {
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(() => ctx.desktopUi.register("route", {
      id: "example.route", path: "/plugin/example", title: "Example",
      icon: "blocks", keywords: ["example"],
      navigation: { label: "Example", section: "secondary" }, component: Page,
    }));
  },
};
```
