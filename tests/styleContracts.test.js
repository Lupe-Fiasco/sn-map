import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../tailwind.config.js";
import { ui } from "../src/uiClassNames.js";
import { getCreateActionPresentation } from "../src/services/mapEditing.js";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const root = postcss.parse(css);

function declarationsFor(selector) {
    const declarations = new Map();
    root.walkRules((rule) => {
        if (rule.selectors.includes(selector)) rule.walkDecls((declaration) => declarations.set(declaration.prop, declaration.value));
    });
    return declarations;
}

test("Tailwind 可执行生成 cyber/minimal 根 class 主题 variant", async () => {
    const result = await postcss(tailwindcss({
        ...config,
        content: [{ raw: '<div class="cyber:bg-black minimal:shadow-none"></div>', extension: "html" }],
    })).process("@tailwind utilities;", { from: undefined });
    assert.match(result.css, /\.theme-cyberpunk \.cyber\\:bg-black/);
    assert.match(result.css, /\.theme-minimal \.minimal\\:shadow-none/);
});

test("通用卡片不携带 minimal 覆盖，地图专用 utility 独占极简卡片规则", () => {
    // ai coding：直接校验运行时组合的 utility 契约，阻止地图主题再次扩散至地点、快照及确认框。
    assert.doesNotMatch(ui.card, /(?:^|\s)minimal:/);
    assert.deepEqual(
        Object.entries(ui).filter(([, className]) => /(?:^|\s)minimal:/.test(className)).map(([name]) => name),
        ["mapCard"],
    );
    assert.match(ui.mapCard, /(?:^|\s)minimal:border-\[#dedede\](?:\s|$)/);
    assert.match(ui.mapCard, /(?:^|\s)minimal:shadow-none(?:\s|$)/);
});

test("实际文本 utility 经 Tailwind 编译后提供分层的赛博前景色", async () => {
    // ai coding：执行 Tailwind 的真实 content 扫描并检查产物声明，而不是对组件源码做正则匹配。
    const result = await postcss(tailwindcss(config)).process("@tailwind utilities;", { from: new URL("../src/styles.css", import.meta.url).pathname });
    const generated = postcss.parse(result.css);
    const cyberColors = new Set();
    generated.walkRules((rule) => {
        if (!rule.selector.includes(".theme-cyberpunk")) return;
        rule.walkDecls("color", (declaration) => cyberColors.add(declaration.value));
    });

    assert.match(ui.themeMuted, /cyber:text/);
    assert.match(ui.themeLabel, /cyber:text/);
    assert.match(ui.themeBody, /cyber:text/);
    assert.ok(cyberColors.has("rgb(159 200 211 / var(--tw-text-opacity, 1))"), "muted 青灰色未生成");
    assert.ok(cyberColors.has("rgb(185 180 232 / var(--tw-text-opacity, 1))"), "label 浅紫色未生成");
    assert.ok(cyberColors.has("rgb(204 235 242 / var(--tw-text-opacity, 1))"), "正文青灰色未生成");
});

test("主按钮与地图选择卡片生成不可被基础白底覆盖的主题声明", async () => {
    const result = await postcss(tailwindcss(config)).process("@tailwind utilities;", { from: new URL("../src/styles.css", import.meta.url).pathname });
    const generated = postcss.parse(result.css);
    const importantBackgrounds = [];
    const importantColors = [];
    generated.walkDecls((declaration) => {
        if (!declaration.important) return;
        if (["background", "background-color", "background-image"].includes(declaration.prop)) importantBackgrounds.push(declaration.value);
        if (declaration.prop === "color") importantColors.push(declaration.value);
    });
    assert.ok(importantBackgrounds.some((value) => value.includes("22 120 95")), "普通主按钮绿色背景未生成");
    assert.ok(importantBackgrounds.some((value) => value.includes("linear-gradient") && value.includes("#5deaff")), "赛博主按钮渐变未生成");
    assert.ok(importantBackgrounds.includes("#10172b"), "赛博地图选择卡片的背景重置未生成");
    assert.ok(importantColors.some((value) => value.includes("255 255 255")), "普通主按钮白色前景未生成");
});

test("3D 新增按钮经 Tailwind 编译后由赛博灰态清除主按钮霓虹渐变", async () => {
    // ai coding：使用真实按钮 class 组合编译，直接检查普通与赛博 hover 产物均锁定灰色背景并清除渐变。
    const className = getCreateActionPresentation("3d", false, false).className;
    const result = await postcss(tailwindcss({
        ...config,
        content: [{ raw: `<button class="${className}"></button>`, extension: "html" }],
    })).process("@tailwind utilities;", { from: undefined });
    const generated = postcss.parse(result.css);
    const hoverDeclarations = {
        normal: new Map(),
        cyber: new Map(),
    };
    generated.walkRules((rule) => {
        if (!rule.selector.includes(":hover") || !rule.selector.includes("[aria-disabled=\"true\"]")) return;
        const declarations = rule.selector.includes(".theme-cyberpunk")
            ? hoverDeclarations.cyber
            : hoverDeclarations.normal;
        rule.walkDecls((declaration) => declarations.set(declaration.prop, {
            value: declaration.value,
            important: declaration.important,
        }));
    });

    assert.deepEqual(hoverDeclarations.normal.get("background-color"), {
        value: "rgb(238 241 239 / var(--tw-bg-opacity, 1))",
        important: true,
    });
    assert.deepEqual(hoverDeclarations.normal.get("background-image"), { value: "none", important: true });
    assert.deepEqual(hoverDeclarations.cyber.get("background-color"), {
        value: "rgb(23 32 51 / var(--tw-bg-opacity, 1))",
        important: true,
    });
    assert.deepEqual(hoverDeclarations.cyber.get("background-image"), { value: "none", important: true });
});

test("赛博 TypeSelect 使用高对比 focus-visible 轮廓", () => {
    const focus = declarationsFor(".theme-cyberpunk .type-select-trigger:focus-visible");
    assert.equal(focus.get("outline"), "3px solid #68edff");
    assert.equal(focus.get("outline-offset"), "2px");
});

test("应用主题 CSS 不再使用 data-visual-mode，复杂地图规则保留 class 作用域", () => {
    assert.doesNotMatch(css, /data-visual-mode/);
    const collapsed = declarationsFor(".theme-cyberpunk .map-visual-cyberpunk .leaflet-control-layers-toggle");
    const expanded = declarationsFor(".theme-cyberpunk .map-visual-cyberpunk .leaflet-control-layers-expanded");
    assert.match(collapsed.get("filter"), /invert\(.+drop-shadow\(/);
    assert.match(expanded.get("box-shadow"), /#68edff/);
});

test("公开快照 Header 与 footer 继续保留独立宽度约束", () => {
    for (const selector of [".public-header", ".public-share-page > footer"]) {
        const declarations = declarationsFor(selector);
        assert.equal(declarations.get("width"), "calc(100% - 48px)");
        assert.equal(declarations.get("max-width"), "1440px");
    }
});
