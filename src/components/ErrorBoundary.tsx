import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Applicatiefout afgevangen door ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-amber-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold text-slate-900">Er ging iets mis</h2>
            </div>
            <p className="text-xs text-slate-600 break-words font-mono-num bg-slate-50 p-3 rounded-lg border border-slate-200">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Herlaad applicatie
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
