import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface AppErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App module crashed:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="p-6">
        <div className="max-w-2xl rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-gray-900">This section could not load</h1>
              <p className="mt-1 text-sm text-gray-600">
                Something went wrong in this module. The rest of the CRM is still available.
              </p>
              {this.state.error?.message && (
                <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                  {this.state.error.message}
                </p>
              )}
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: undefined })}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
