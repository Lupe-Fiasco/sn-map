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

test("设置入口显示三种 aria 单选项并回调所选模式", () => {
    let selected = "";
    const renderer = TestRenderer.create(React.createElement(AppHeader, {
        mapName: "睢宁县",
        userLabel: "匿名会话",
        isAdmin: false,
        visualMode: "normal",
        onVisualModeChange: (mode) => { selected = mode; },
    }));
    const trigger = renderer.root.findByProps({ "aria-label": "视觉模式设置" });
    act(() => trigger.props.onClick());
    const options = renderer.root.findAllByProps({ role: "radio" });
    assert.deepEqual(options.map((option) => option.props["aria-checked"]), [true, false, false]);
    act(() => options[1].props.onClick());
    assert.equal(selected, "cyberpunk");
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
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
