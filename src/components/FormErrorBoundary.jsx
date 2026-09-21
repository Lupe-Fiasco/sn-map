import { Component } from "react";

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
    return <div className="editor-panel" role="alert"><h3>无法打开地点表单</h3><p className="form-error">表单状态无效，请关闭后重新操作。</p><button className="button" type="button" onClick={this.props.onClose}>关闭表单</button></div>;
  }
}
