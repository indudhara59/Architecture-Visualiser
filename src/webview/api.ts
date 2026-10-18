declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};

const vscode = acquireVsCodeApi();

export type ToExtension =
  | { type: 'ready' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'refresh' }
  | { type: 'exportMermaid' }
  | { type: 'saveImage'; format: 'svg' | 'png'; data: string }
  | { type: 'saveSnapshot' }
  | { type: 'clearSnapshot' }
  | { type: 'createRules' }
  | { type: 'openRules' }
  | { type: 'pickFolder' }
  | { type: 'copyText'; text: string; label?: string };

export function post(msg: ToExtension): void {
  vscode.postMessage(msg);
}

export function loadState<T>(): Partial<T> {
  return (vscode.getState() as Partial<T>) ?? {};
}

export function saveState(s: unknown): void {
  vscode.setState(s);
}
