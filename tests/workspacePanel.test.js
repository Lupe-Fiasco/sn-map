import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ManagementWorkspace from "../src/components/ManagementWorkspace.jsx";

test("管理工作区可执行收起与展开，并保留完整 aria 恢复入口", () => {
    // ai coding：在 jsdom 中挂载真实 React DOM，直接验证 inert 切换前后的 document.activeElement。
    const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", { url: "http://localhost" });
    const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.getElementById("root"));
    try {
        act(() => root.render(React.createElement(ManagementWorkspace, {
            sidebar: React.createElement("section", null, "地点维护内容"),
        }, React.createElement("section", null, "地图"))));
        const aside = document.querySelector('[aria-label="地点维护面板"]');
        const collapse = document.querySelector('[aria-label="收起右侧面板"]');
        assert.equal(collapse.title, "收起右侧面板");
        collapse.focus();
        assert.equal(document.activeElement, collapse);

        act(() => collapse.click());
        const expand = document.querySelector('[aria-label="展开右侧面板"]');
        assert.equal(document.activeElement, expand);
        assert.equal(aside.getAttribute("aria-hidden"), "true");
        assert.equal(aside.hasAttribute("inert"), true);
        assert.equal(aside.contains(document.activeElement), false);

        assert.equal(expand.title, "展开右侧面板");
        act(() => expand.click());
        assert.equal(document.activeElement, collapse);
        assert.equal(aside.getAttribute("aria-hidden"), "false");
        assert.equal(aside.hasAttribute("inert"), false);
        assert.equal(document.querySelector('[aria-label="展开右侧面板"]'), null);
    } finally {
        act(() => root.unmount());
        dom.window.close();
        Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
    }
});
