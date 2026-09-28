import test from "node:test";
import assert from "node:assert/strict";
import { EDIT_IN_2D_MESSAGE, getCreateActionPresentation, runCreateAction } from "../src/services/mapEditing.js";

test("3D 新增主按钮使用可点击的视觉禁用态", () => {
    const presentation = getCreateActionPresentation("3d", false, false);
    assert.match(presentation.className, /\bprimary\b/);
    assert.match(presentation.className, /\bis-disabled\b/);
    assert.equal(presentation.disabled, false);
    assert.equal(presentation["aria-disabled"], true);
    assert.equal(presentation.title, EDIT_IN_2D_MESSAGE);
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
