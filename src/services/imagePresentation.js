export function imageCollectionView({ loading, error, images = [] }) {
  if (loading) return { state: "loading", count: null };
  if (error) return { state: "error", count: null };
  return { state: images.length ? "ready" : "empty", count: images.length };
}

export function imageActions(mode) {
  return { preview: true, upload: mode === "private", delete: mode === "private" };
}

export async function deleteAfterConfirmation(confirmed, deleteImage) {
  if (!confirmed) return false;
  await deleteImage();
  return true;
}
