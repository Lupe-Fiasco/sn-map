import { useState } from "react";
import ImageLightbox from "./ImageLightbox.jsx";
import { imageActions } from "../services/imagePresentation.js";

export default function PublicImageGallery({ images, placeName }) {
  const [preview, setPreview] = useState(null);
  const actions = imageActions("public");
  if (!images.length) return null;
  return <>
    <div className="public-image-grid" aria-label="实景图片">
      {images.map((image) => {
        const alt = image.alt_text || placeName || "地点实景";
        return <button key={image.id} className="image-card" type="button" onClick={() => actions.preview && setPreview({ url: image.url, alt })} aria-label={`预览图片：${alt}`}>
          <img src={image.url} alt={alt} loading="lazy" />
          <span className="image-preview-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.75" /></svg></span>
        </button>;
      })}
    </div>
    <ImageLightbox image={preview} onClose={() => setPreview(null)} />
  </>;
}
