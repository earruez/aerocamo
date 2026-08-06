import { Component, type ErrorInfo, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message ?? 'Error desconocido en la aplicacion.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[AppErrorBoundary] Runtime error captured', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-2xl border border-rose-200 bg-white shadow-sm p-6 space-y-4">
            <div>
              <h1 className="text-lg font-bold text-rose-700">Se produjo un error inesperado</h1>
              <p className="text-sm text-slate-600 mt-1">
                La interfaz se recupero para evitar pantalla en blanco.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Detalle</p>
              <p className="text-sm text-slate-700 mt-1 break-words">
                {this.state.errorMessage || 'Sin detalle disponible'}
              </p>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-primary"
              >
                Recargar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
