import test from "node:test";
import assert from "node:assert/strict";
import { captureOwnerGeneration, createOwnerGeneration, invalidateOwnerGeneration, isOwnerGenerationCurrent, updateOwnerGeneration } from "../src/services/ownerGeneration.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const operationName of ["save", "remove", "local sync"]) {
  test(`${operationName} completion is stale after switching owner`, async () => {
    const state = createOwnerGeneration("owner-a");
    const operation = captureOwnerGeneration(state);
    const request = deferred();
    const committed = [];
    const completion = request.promise.then((value) => {
      if (isOwnerGenerationCurrent(state, operation)) committed.push(value);
    });

    updateOwnerGeneration(state, "owner-b");
    request.resolve(`${operationName}-a`);
    await completion;
    assert.deepEqual(committed, []);

    const ownerBOperation = captureOwnerGeneration(state);
    if (isOwnerGenerationCurrent(state, ownerBOperation)) committed.push(`${operationName}-b`);
    assert.deepEqual(committed, [`${operationName}-b`]);
  });
}

test("a new session generation invalidates operations even when owner is unchanged", () => {
  const state = createOwnerGeneration("owner-a");
  const operation = captureOwnerGeneration(state);
  invalidateOwnerGeneration(state);
  assert.equal(isOwnerGenerationCurrent(state, operation), false);
});

for (const operationName of ["snapshot publish", "snapshot cancel"]) {
  test(`${operationName} stale completion cannot overwrite another owner's state or busy flag`, async () => {
    const state = createOwnerGeneration("owner-a");
    const ownerAOperation = captureOwnerGeneration(state);
    const ownerARequest = deferred();
    const ui = { snapshot: null, status: "A is working", busy: true };
    const ownerACompletion = ownerARequest.promise.then((snapshot) => {
      if (isOwnerGenerationCurrent(state, ownerAOperation)) {
        ui.snapshot = snapshot;
        ui.status = "A completed";
      }
    }).finally(() => {
      if (isOwnerGenerationCurrent(state, ownerAOperation)) ui.busy = false;
    });

    updateOwnerGeneration(state, "owner-b");
    const ownerBOperation = captureOwnerGeneration(state);
    ui.status = "B is working";
    ui.busy = true;
    ownerARequest.resolve({ owner_id: "owner-a" });
    await ownerACompletion;

    assert.deepEqual(ui, { snapshot: null, status: "B is working", busy: true });
    assert.equal(isOwnerGenerationCurrent(state, ownerBOperation), true);
  });
}
