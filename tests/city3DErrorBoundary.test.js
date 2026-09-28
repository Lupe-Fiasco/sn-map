import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import City3DErrorBoundary from "../src/components/City3DErrorBoundary.jsx";
import {
  CITY_3D_IMPORT_ATTEMPTS,
  getCity3DImportAttempt,
  hasNextCity3DImportAttempt,
} from "../src/services/city3DLoader.js";

function ThrowingChild({ shouldThrow, onRender }) {
  onRender();
  if (shouldThrow) throw new Error("3D render failed");
  return React.createElement("div", null, "3D ready");
}

test("City3DErrorBoundary catches render errors and offers 2D recovery", () => {
  let returnCount = 0;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const renderer = TestRenderer.create(React.createElement(
      City3DErrorBoundary,
      { onReturnTo2D: () => { returnCount += 1; }, onRetry: () => {} },
      React.createElement(ThrowingChild, { shouldThrow: true, onRender: () => {} }),
    ));

    const alert = renderer.root.findByProps({ role: "alert" });
    assert.equal(alert.findByType("strong").children.join(""), "3D 城市视图加载失败");
    act(() => renderer.root.findByProps({ children: "返回 2D 地图" }).props.onClick());
    assert.equal(returnCount, 1);
    renderer.unmount();
  } finally {
    console.error = originalConsoleError;
  }
});

test("retry switches to a distinct importer and recovers after the first import rejects", async () => {
  const calls = [];
  const attempts = [
    {
      specifier: "City3DView.jsx?retry=test-0",
      load: () => {
        calls.push("City3DView.jsx?retry=test-0");
        return Promise.reject(new Error("3D chunk failed"));
      },
    },
    {
      specifier: "City3DView.jsx?retry=test-1",
      load: () => {
        calls.push("City3DView.jsx?retry=test-1");
        return Promise.resolve({ default: () => React.createElement("div", null, "3D ready") });
      },
    },
  ];
  let retryCount = 0;

  function Harness() {
    const [index, setIndex] = React.useState(0);
    const attempt = getCity3DImportAttempt(index, attempts);
    const LazyView = React.useMemo(() => React.lazy(attempt.load), [attempt]);
    return React.createElement(
      City3DErrorBoundary,
      {
        canRetry: hasNextCity3DImportAttempt(index, attempts),
        onReturnTo2D: () => {},
        onRetry: () => {
          retryCount += 1;
          setIndex((value) => value + 1);
        },
      },
      React.createElement(
        React.Suspense,
        { fallback: React.createElement("div", null, "loading") },
        React.createElement(LazyView),
      ),
    );
  }

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness));
      await Promise.resolve();
    });

    assert.deepEqual(calls, [attempts[0].specifier]);
    await act(async () => {
      renderer.root.findByProps({ children: "重试加载 3D" }).props.onClick();
      await Promise.resolve();
    });
    assert.equal(retryCount, 1);
    assert.notEqual(attempts[0].load, attempts[1].load);
    assert.notEqual(attempts[0].specifier, attempts[1].specifier);
    assert.deepEqual(calls, attempts.map((attempt) => attempt.specifier));
    assert.equal(renderer.root.findByType("div").children.join(""), "3D ready");
    renderer.unmount();
  } finally {
    console.error = originalConsoleError;
  }
});

test("production retry attempts expose distinct statically declared specifiers and loaders", () => {
  assert.ok(CITY_3D_IMPORT_ATTEMPTS.length >= 3);
  assert.equal(new Set(CITY_3D_IMPORT_ATTEMPTS.map(({ specifier }) => specifier)).size, CITY_3D_IMPORT_ATTEMPTS.length);
  assert.equal(new Set(CITY_3D_IMPORT_ATTEMPTS.map(({ load }) => load)).size, CITY_3D_IMPORT_ATTEMPTS.length);
  assert.match(CITY_3D_IMPORT_ATTEMPTS[0].specifier, /retry=0$/);
  assert.match(CITY_3D_IMPORT_ATTEMPTS[1].specifier, /retry=1$/);
});
