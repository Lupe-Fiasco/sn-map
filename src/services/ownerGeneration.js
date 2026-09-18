export function createOwnerGeneration(ownerId) {
  return { ownerId, generation: 0 };
}

export function updateOwnerGeneration(state, ownerId) {
  if (state.ownerId === ownerId) return false;
  state.ownerId = ownerId;
  state.generation += 1;
  return true;
}

export function invalidateOwnerGeneration(state) {
  state.generation += 1;
}

export function captureOwnerGeneration(state) {
  return { ownerId: state.ownerId, generation: state.generation };
}

export function isOwnerGenerationCurrent(state, operation) {
  return Boolean(operation && state.ownerId === operation.ownerId && state.generation === operation.generation);
}

export function staleOwnerOperationError() {
  return new Error("账号已切换，旧操作结果已忽略，请在当前账号重试");
}
