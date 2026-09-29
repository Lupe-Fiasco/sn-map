import plugin from "tailwindcss/plugin.js";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [
    plugin(({ addVariant }) => {
      // ai coding：主题 variant 只依赖根节点稳定 class，业务组件不再绑定 data 属性选择器。
      addVariant("cyber", ".theme-cyberpunk &");
      addVariant("minimal", ".theme-minimal &");
    }),
  ],
};
