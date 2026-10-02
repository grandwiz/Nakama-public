import { createContext, useContext } from "react";
import type { AppState, Page } from "./types";
import type { CheckReviewDraft } from "./check-review";
export interface NakamaContext {
  state: AppState;
  refresh: () => Promise<void>;
  perform: <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    success?: string,
  ) => Promise<T | undefined>;
  notify: (message: string, error?: boolean) => void;
  navigate: (page: Page, options?: { browserSessionId?: string }) => void;
  openProject: (id: string) => void;
  openApproval: (id: string) => void;
  openAssistant: (projectId: string, draft?: CheckReviewDraft) => void;
  createProject: () => void;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
}
export const Context = createContext<NakamaContext | null>(null);
export function useNakama() {
  const context = useContext(Context);
  if (!context) throw new Error("Nakama context missing");
  return context;
}
