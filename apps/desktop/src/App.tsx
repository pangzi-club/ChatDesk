import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatLayoutProvider } from "@/components/chat-layout-provider";
import { ChatLayoutThemeLayer } from "@/components/chat-layout-theme-layer";
import { DesktopUiProvider } from "@/components/desktop-ui-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import type { DesktopUiRuntime } from "@/lib/plugins/desktop-ui";
import { AppRouter } from "@/router/routes";

import "./App.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20 * 60_000,
      gcTime: 20 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App({ desktopUiRuntime }: { desktopUiRuntime: DesktopUiRuntime }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DesktopUiProvider service={desktopUiRuntime.service}>
          <ChatLayoutProvider service={desktopUiRuntime.chatLayouts}>
            <AppRouter />
            <ChatLayoutThemeLayer />
          </ChatLayoutProvider>
          <Toaster />
        </DesktopUiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
