import React from "react";

export default function PublicSharePageFrame({ children }) {
    // ai coding：公开页主题背景由根 theme class 的 Tailwind variant 驱动，短状态页同样覆盖动态视口。
    return <div className="public-share-page min-h-screen bg-[#f6f7f2] text-[#19332e] cyber:bg-[#070b18] cyber:text-[#e6fbff] minimal:bg-[#fafafa]">{children}</div>;
}
