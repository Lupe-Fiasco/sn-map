import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const root = postcss.parse(css);

function declarationsFor(selector) {
    const declarations = new Map();
    root.walkRules((rule) => {
        if (rule.selectors.includes(selector)) {
            rule.walkDecls((declaration) => declarations.set(declaration.prop, declaration.value));
        }
    });
    return declarations;
}

function declarationValuesFor(selector, property) {
    const values = [];
    root.walkRules((rule) => {
        if (rule.selectors.includes(selector)) {
            rule.walkDecls(property, (declaration) => values.push(declaration.value));
        }
    });
    return values;
}

test("公开快照 Header 与 footer 具有独立的居中宽度约束", () => {
    const header = declarationsFor(".public-header");
    const footer = declarationsFor(".public-share-page > footer");

    for (const declarations of [header, footer]) {
        assert.equal(declarations.get("width"), "calc(100% - 48px)");
        assert.equal(declarations.get("max-width"), "1440px");
        assert.equal(declarations.get("margin-inline"), "auto");
    }
    assert.equal(declarationsFor(".site-header.management-header").get("max-width"), undefined);
});

test("公开页与审核门禁的页面画布覆盖动态视口并具有完整主题背景", () => {
    for (const selector of [".public-share-page", ".approval-page"]) {
        assert.deepEqual(declarationValuesFor(selector, "min-height"), ["100vh", "100dvh"]);
        assert.equal(declarationsFor(selector).get("background"), "#f6f7f2");
    }

    assert.equal(declarationsFor('html[data-visual-mode="cyberpunk"] :is(.approval-page, .public-share-page)').get("background"), "#070b18");
    assert.equal(declarationsFor('html[data-visual-mode="minimal"] :is(.approval-page, .public-share-page)').get("background"), "#fafafa");
});

test("赛博 Leaflet 图层控件在折叠与展开状态均有主题限定的高对比处理", () => {
    const themeScope = ':is(.theme-cyberpunk, [data-visual-mode="cyberpunk"]) .map-visual-cyberpunk';
    const collapsed = declarationsFor(`${themeScope} .leaflet-control-layers-toggle`);
    const expanded = declarationsFor(`${themeScope} .leaflet-control-layers-expanded`);

    assert.match(collapsed.get("filter"), /invert\(.+drop-shadow\(/);
    assert.match(expanded.get("box-shadow"), /#68edff/);
    assert.equal(declarationsFor(".map-visual-normal .leaflet-control-layers-toggle").get("filter"), undefined);
    assert.equal(declarationsFor(".map-visual-minimal .leaflet-control-layers-toggle").get("filter"), undefined);
});

test("公开视图工具栏仅在赛博作用域使用深色霓虹主题", () => {
    const cyberToolbar = declarationsFor('html[data-visual-mode="cyberpunk"] .public-view-toolbar');
    const cyberHint = declarationsFor('html[data-visual-mode="cyberpunk"] .public-view-toolbar > span');
    const normalToolbar = declarationsFor(".public-view-toolbar");

    assert.match(cyberToolbar.get("background"), /linear-gradient/);
    assert.match(cyberToolbar.get("border-color"), /104, 237, 255/);
    assert.match(cyberToolbar.get("box-shadow"), /189, 147, 255/);
    assert.equal(cyberToolbar.get("color"), "var(--cyber-text)");
    assert.equal(cyberHint.get("color"), "var(--cyber-muted)");
    assert.equal(normalToolbar.get("background"), "#f8faf8");
    assert.equal(declarationsFor('html[data-visual-mode="minimal"] .public-view-toolbar').size, 0);
});
