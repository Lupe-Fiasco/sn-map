import test from "node:test";
import assert from "node:assert/strict";
import { EDIT_IN_2D_MESSAGE, getCreateActionPresentation, runCreateAction } from "../src/services/mapEditing.js";

test("3D 新增主按钮使用可点击的视觉禁用态", () => {
    const presentation = getCreateActionPresentation("3d", false, false);
    assert.match(presentation.className, /aria-disabled:hover:!bg-\[#eef1ef\]/);
    assert.match(presentation.className, /aria-disabled:hover:!\[background-image:none\]/);
    assert.match(presentation.className, /cyber:aria-disabled:hover:!bg-\[#172033\]/);
    assert.match(presentation.className, /cyber:aria-disabled:hover:!\[background-image:none\]/);
    assert.doesNotMatch(presentation.className, /\b(?:primary|is-disabled)\b/);
    assert.equal(presentation.disabled, false);
    assert.equal(presentation["aria-disabled"], true);
    assert.equal(presentation.title, EDIT_IN_2D_MESSAGE);
});

test("2D 三类新增入口共用高对比主按钮状态，激活入口回到普通按钮", () => {
    const inactiveActions = ["point", "line", "polygon"].map(() => getCreateActionPresentation("2d", false, false));
    for (const presentation of inactiveActions) {
        assert.match(presentation.className, /!bg-\[#16785f\]/);
        assert.match(presentation.className, /!text-white/);
        assert.match(presentation.className, /cyber:!text-\[#04131d\]/);
        assert.equal(presentation["aria-disabled"], false);
    }
    const active = getCreateActionPresentation("2d", false, true);
    assert.doesNotMatch(active.className, /!bg-\[#16785f\]/);
    assert.match(active.className, /bg-white/);
});

test("3D 新增入口提示切换 2D 且不执行原操作", () => {
    const messages = [];
    let starts = 0;
    const result = runCreateAction("3d", (message) => messages.push(message), () => { starts += 1; });
    assert.equal(result, false);
    assert.deepEqual(messages, [EDIT_IN_2D_MESSAGE]);
    assert.equal(starts, 0);
});

test("2D 新增入口完全执行原操作", () => {
    let starts = 0;
    const result = runCreateAction("2d", () => {}, () => { starts += 1; });
    assert.equal(result, true);
    assert.equal(starts, 1);
});
