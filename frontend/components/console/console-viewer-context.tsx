"use client";

import { createContext, useContext, useState } from "react";
import type { ConsoleViewer } from "@/lib/console-viewer";

type ConsoleViewerContextValue = {
  viewer: ConsoleViewer;
  updateViewer: (updates: Partial<ConsoleViewer>) => void;
};

const ConsoleViewerContext = createContext<ConsoleViewerContextValue | null>(null);

type ConsoleViewerProviderProps = {
  viewer: ConsoleViewer;
  children: React.ReactNode;
};

export function ConsoleViewerProvider({
  viewer,
  children,
}: ConsoleViewerProviderProps) {
  const [viewerState, setViewerState] = useState(viewer);

  return (
    <ConsoleViewerContext.Provider
      value={{
        viewer: viewerState,
        updateViewer(updates) {
          setViewerState((current) => ({
            ...current,
            ...updates,
          }));
        },
      }}
    >
      {children}
    </ConsoleViewerContext.Provider>
  );
}

export function useConsoleViewer(): ConsoleViewer {
  const context = useContext(ConsoleViewerContext);

  if (!context) {
    throw new Error("useConsoleViewer must be used within ConsoleViewerProvider.");
  }

  return context.viewer;
}

export function useConsoleViewerActions() {
  const context = useContext(ConsoleViewerContext);

  if (!context) {
    throw new Error("useConsoleViewerActions must be used within ConsoleViewerProvider.");
  }

  return {
    updateViewer: context.updateViewer,
  };
}
