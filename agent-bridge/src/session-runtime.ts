export interface SessionPrompt {
  sessionId: string;
  text: string;
}

export interface SessionRuntime {
  prompt(input: SessionPrompt): Promise<void>;
  abort(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

