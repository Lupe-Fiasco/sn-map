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

test("公开快照 Header 与 footer 具有独立的居中宽度约束", () => {
    const header = declarationsFor(".public-header");
    const footer = declarationsFor(":where(#root:has(> .public-header) > footer)");

    for (const declarations of [header, footer]) {
        assert.equal(declarations.get("width"), "calc(100% - 48px)");
        assert.equal(declarations.get("max-width"), "1440px");
        assert.equal(declarations.get("margin-inline"), "auto");
    }
    assert.equal(declarationsFor(".site-header.management-header").get("max-width"), undefined);
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
