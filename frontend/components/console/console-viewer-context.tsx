"use client";

import { createContext, useContext } from "react";
import type { ConsoleViewer } from "@/lib/console-viewer";

const ConsoleViewerContext = createContext<ConsoleViewer | null>(null);

type ConsoleViewerProviderProps = {
  viewer: ConsoleViewer;
  children: React.ReactNode;
};

export function ConsoleViewerProvider({
  viewer,
  children,
}: ConsoleViewerProviderProps) {
  return (
    <ConsoleViewerContext.Provider value={viewer}>
      {children}
    </ConsoleViewerContext.Provider>
  );
}

export function useConsoleViewer(): ConsoleViewer {
  const viewer = useContext(ConsoleViewerContext);

  if (!viewer) {
    throw new Error("useConsoleViewer must be used within ConsoleViewerProvider.");
  }

  return viewer;
}
