import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import AppHeader, { handleAccountMenuEscape, isOutsideAccountMenu } from "../src/components/AppHeader.jsx";

function renderHeader(isAdmin = false) {
    return TestRenderer.create(React.createElement(AppHeader, {
        mapName: "睢宁县",
        maps: [{ id: "suining", name: "睢宁县" }],
        mapId: "suining",
        mapDisabled: false,
        onMapChange: () => {},
        userLabel: isAdmin ? "admin@example.com" : "匿名会话",
        isAdmin,
        accountContent: React.createElement("section", { "data-panel": "account" }, "账号内容"),
        adminContent: React.createElement("section", { "data-panel": "admin" }, "管理员内容"),
        visualMode: "normal",
        onVisualModeChange: () => {},
    }));
}

test("Header 用户按钮可打开及再次点击关闭账号浮层", () => {
    const renderer = renderHeader(false);
    const trigger = renderer.root.findByProps({ "aria-label": "用户信息：匿名会话" });
    assert.equal(trigger.props["aria-expanded"], false);
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);

    act(() => trigger.props.onClick());
    assert.equal(renderer.root.findByProps({ "aria-label": "用户信息：匿名会话" }).props["aria-expanded"], true);
    assert.equal(renderer.root.findAllByProps({ "data-panel": "account" }).length, 1);
    assert.equal(renderer.root.findAllByProps({ "data-panel": "admin" }).length, 0);

    act(() => renderer.root.findByProps({ "aria-label": "用户信息：匿名会话" }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
    renderer.unmount();
});

test("管理员权限满足时才在用户浮层显示管理员内容", () => {
    const renderer = renderHeader(true);
    act(() => renderer.root.findByProps({ "aria-label": "用户信息：admin@example.com" }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ "data-panel": "account" }).length, 1);
    assert.equal(renderer.root.findAllByProps({ "data-panel": "admin" }).length, 1);
    renderer.unmount();
});

test("切换主题入口显示三种 aria 单选项并回调所选模式", () => {
    let selected = "";
    const renderer = TestRenderer.create(React.createElement(AppHeader, {
        mapName: "睢宁县",
        userLabel: "匿名会话",
        isAdmin: false,
        visualMode: "normal",
        onVisualModeChange: (mode) => { selected = mode; },
    }));
    const trigger = renderer.root.findByProps({ "aria-label": "切换主题" });
    assert.equal(trigger.props.title, "切换主题");
    assert.equal(trigger.findByType("span").children.join(""), "切换主题");
    act(() => trigger.props.onClick());
    assert.equal(renderer.root.findByProps({ role: "dialog" }).props["aria-label"], "切换主题");
    assert.equal(renderer.root.findByProps({ id: "visual-mode-title" }).children.join(""), "切换主题");
    const options = renderer.root.findAllByProps({ role: "radio" });
    assert.deepEqual(options.map((option) => option.props["aria-checked"]), [true, false, false]);
    assert.match(options[0].props.className, /cyber:aria-checked:border-\[#68edff\]/);
    act(() => options[1].props.onClick());
    assert.equal(selected, "cyberpunk");
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
    renderer.unmount();
});

test("Header 保留紧凑高度与独立横向留白，并通过主题 utility 着色", () => {
    const renderer = renderHeader(false);
    const header = renderer.root.findByType("header");
    const inner = header.find((node) => node.type === "div" && node.props.className?.includes("site-header-inner"));
    assert.match(header.props.className, /cyber:bg-\[rgba\(8,13,28,\.96\)\]/);
    assert.match(inner.props.className, /min-h-\[68px\]/);
    assert.match(inner.props.className, /px-\[30px\]/);
    renderer.unmount();
});

test("账号浮层仅将容器外部命中识别为关闭事件", () => {
    const inside = {};
    const outside = {};
    const container = { contains: (target) => target === inside };
    assert.equal(isOutsideAccountMenu(container, inside), false);
    assert.equal(isOutsideAccountMenu(container, outside), true);
});

test("账号浮层打开时消费 Escape，关闭时保留地图全局 Escape", () => {
    let closed = 0;
    let prevented = 0;
    let stopped = 0;
    const event = {
        key: "Escape",
        preventDefault: () => { prevented += 1; },
        stopPropagation: () => { stopped += 1; },
    };

    assert.equal(handleAccountMenuEscape(event, true, () => { closed += 1; }), true);
    assert.deepEqual({ closed, prevented, stopped }, { closed: 1, prevented: 1, stopped: 1 });

    assert.equal(handleAccountMenuEscape(event, false, () => { closed += 1; }), false);
    assert.deepEqual({ closed, prevented, stopped }, { closed: 1, prevented: 1, stopped: 1 });
});
