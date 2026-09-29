import { Component } from "react";
import { ui } from "../uiClassNames.js";

export default class FormErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("地点表单渲染失败：", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // ai coding：即使异常表单状态绕过前置校验，也只降级当前面板，绝不卸载整棵应用 root。
    return <div className="mt-4" role="alert"><h3 className="m-0 text-base font-bold">无法打开地点表单</h3><p className={ui.error}>表单状态无效，请关闭后重新操作。</p><button className={`${ui.button} mt-3`} type="button" onClick={this.props.onClose}>关闭表单</button></div>;
  }
}
