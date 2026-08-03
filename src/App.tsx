import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">m-dashboard</p>
          <h1 className="text-3xl font-semibold tracking-normal">Tailwind CSS + shadcn/ui</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Tailwind utility classes, shadcn theme tokens, and reusable UI components are ready.
          </p>
        </header>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void greet();
          }}
        >
          <input
            id="greet-input"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Enter a name..."
            value={name}
          />
          <Button type="submit">Greet</Button>
        </form>

        {greetMsg ? (
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow-xs">
            {greetMsg}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export default App;
