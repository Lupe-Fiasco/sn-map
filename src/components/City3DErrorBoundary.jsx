import React, { Component } from "react";

export default class City3DErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("3D 城市视图加载或渲染失败：", error);
  }

  handleRetry = () => {
    if (this.props.canRetry === false) return;
    // ai coding：先通知父级切换到下一个 cache-busting loader，再清除错误态，保留 3D 模式与应用内存状态。
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    // ai coding：3D 模块单独降级，动态导入或渲染初始化异常不会卸载管理端及 2D 编辑状态。
    return (
      <div className="city3d-message error" role="alert">
        <strong>3D 城市视图加载失败</strong>
        <span>当前设备暂时无法启动 3D 视图，您可以返回 2D 地图继续操作。</span>
        <div className="city3d-actions">
          <button className="button primary" type="button" onClick={this.props.onReturnTo2D}>返回 2D 地图</button>
          <button className="button" type="button" onClick={this.handleRetry} disabled={this.props.canRetry === false}>
            {this.props.canRetry === false ? "重试次数已用完" : "重试加载 3D"}
          </button>
        </div>
      </div>
    );
  }
}
