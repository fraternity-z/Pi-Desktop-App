export type DesktopUiRequest =
  | {
      kind: "confirm";
      requestId: string;
      title: string;
      message: string;
    }
  | {
      kind: "select";
      requestId: string;
      title: string;
      options: readonly string[];
    };

export interface ExtensionAdapter {
  requestUi(request: DesktopUiRequest): Promise<unknown>;
}

