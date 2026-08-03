import { AppRouter } from "@/router/routes";
import { ThemeProvider } from "@/components/theme-provider";

import "./App.css";

function App() {
  return (
    <ThemeProvider>
      <AppRouter />
    </ThemeProvider>
  );
}

export default App;
