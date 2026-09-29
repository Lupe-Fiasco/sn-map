import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer from "react-test-renderer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import MapSelectionCard from "../src/components/MapSelectionCard.jsx";
import config from "../tailwind.config.js";

test("选择地图卡片渲染主题表面及可访问标签", () => {
    // ai coding：渲染真实组件验证主题 class 与表单语义同时存在，不以源码文本匹配代替组件契约。
    const renderer = TestRenderer.create(React.createElement(MapSelectionCard, {
        maps: [{ id: "suining", name: "睢宁县" }],
        mapId: "suining",
        mapName: "睢宁县",
        disabled: false,
        onChange: () => {},
    }));
    const section = renderer.root.findByType("section");
    const select = renderer.root.findByType("select");
    assert.match(section.props.className, /!bg-\[linear-gradient/);
    assert.match(section.props.className, /cyber:!\[background:#10172b\]/);
    assert.match(section.props.className, /cyber:!border-\[#1c6574\]/);
    assert.match(section.props.className, /minimal:!\[background:white\]/);
    assert.equal(section.props["aria-labelledby"], "map-selection-title");
    assert.equal(select.props.id, "management-map-select");
    assert.equal(renderer.root.findByProps({ id: "map-selection-title" }).children.join(""), "选择地图");
    renderer.unmount();
});

test("选择地图卡片的 Tailwind 产物在赛博模式清除白色渐变", async () => {
    const renderer = TestRenderer.create(React.createElement(MapSelectionCard, {
        maps: [{ id: "suining", name: "睢宁县" }],
        mapId: "suining",
        mapName: "睢宁县",
        disabled: false,
        onChange: () => {},
    }));
    const section = renderer.root.findByType("section");
    const select = renderer.root.findByType("select");
    const markup = `<section class="${section.props.className}"><select class="${select.props.className}"></select></section>`;
    renderer.unmount();

    // ai coding：编译真实渲染 class 并检查最终主题规则；background 简写必须重置普通模式的白色 background-image。
    const result = await postcss(tailwindcss({
        ...config,
        content: [{ raw: markup, extension: "html" }],
    })).process("@tailwind utilities;", { from: undefined });
    const generated = postcss.parse(result.css);
    const cardBackgrounds = [];
    const controlBackgrounds = [];
    generated.walkRules((rule) => {
        if (!rule.selector.includes(".theme-cyberpunk")) return;
        rule.walkDecls((declaration) => {
            const entry = { property: declaration.prop, value: declaration.value, important: declaration.important };
            if (declaration.prop === "background") cardBackgrounds.push(entry);
            if (declaration.prop === "background-color") controlBackgrounds.push(entry);
        });
    });

    assert.deepEqual(cardBackgrounds, [{ property: "background", value: "#10172b", important: true }]);
    assert.ok(controlBackgrounds.some(({ property, value }) => property === "background-color" && value.includes("11 20 43")), "select 未生成赛博深色背景");
    assert.equal(cardBackgrounds.some(({ value }) => /#fff|white/i.test(value)), false);
});
