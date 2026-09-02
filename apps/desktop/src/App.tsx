import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { ChatLayoutProvider, type ChatLayoutRuntime } from "@/lib/chat-layout";
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

function App({ chatLayoutRuntime }: { chatLayoutRuntime: ChatLayoutRuntime }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ChatLayoutProvider service={chatLayoutRuntime.service}>
          <AppRouter />
        </ChatLayoutProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
