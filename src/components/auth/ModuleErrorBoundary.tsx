import React from "react";

interface Props {
  children: React.ReactNode;
  moduleName?: string;
  onNavigate?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ModuleErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[${this.props.moduleName || "Module"} Error]:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleDashboard = () => {
    if (this.props.onNavigate) {
      this.setState({ hasError: false, error: null });
      this.props.onNavigate();
    } else {
      window.location.href = "/dashboard";
    }
  };

  render() {
    if (this.state.hasError) {
      const moduleName = this.props.moduleName || "This module";
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="bg-card border border-border rounded-2xl shadow-lg max-w-md w-full p-8 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-bold text-foreground">
              Error in {moduleName}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Something went wrong in the {moduleName} module. Other modules are
              unaffected — you can return to the dashboard or retry.
            </p>
            <p className="text-xs font-mono text-muted-foreground/70 bg-muted rounded-lg px-3 py-2 break-all">
              {this.state.error?.message}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleDashboard}
                className="px-4 py-2.5 rounded-lg bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors"
              >
                ← Dashboard
              </button>
              <button
                onClick={this.handleRetry}
                className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ModuleErrorBoundary;
