import { type Context, Service } from "cordis";
import type { ComponentType, ReactNode } from "react";

export type ChatLayout = string;

export type ChatLayoutScope = {
  sessionId: string;
  workspaceId: string;
  cwd: string;
  isGenerating: boolean;
  isReadOnly: boolean;
};

export type ChatLayoutProps = { children: ReactNode; scope: ChatLayoutScope };

export type ChatLayoutComponent = ComponentType<ChatLayoutProps>;

export type ChatLayoutContribution = {
  id: ChatLayout;
  label: string;
  order?: number;
  component: ChatLayoutComponent;
};

export type ChatLayoutSnapshot = {
  id: ChatLayout;
  component: ChatLayoutComponent | undefined;
};

declare module "cordis" {
  interface Context {
    chatLayouts: ChatLayoutService;
  }
}

export class ChatLayoutService extends Service {
  private readonly definitions = new Map<ChatLayout, ChatLayoutComponent>();
  private readonly listeners = new Set<() => void>();
  private snapshot: ChatLayoutSnapshot = { id: "standard", component: undefined };

  constructor(ctx: Context) {
    super(ctx, "chatLayouts");
  }

  register(id: ChatLayout, component: ChatLayoutComponent) {
    if (this.definitions.has(id)) throw new Error(`chat layout already registered: ${id}`);
    this.definitions.set(id, component);
    if (!this.snapshot.component) this.snapshot = { id, component };
    this.notify();
    return () => {
      this.definitions.delete(id);
      if (this.snapshot.id === id) {
        const next = this.definitions.entries().next().value as
          | [ChatLayout, ChatLayoutComponent]
          | undefined;
        this.snapshot = next
          ? { id: next[0], component: next[1] }
          : { id: "standard", component: undefined };
      }
      this.notify();
    };
  }

  registerContribution(contribution: ChatLayoutContribution) {
    return this.register(contribution.id, contribution.component);
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  activate(id: ChatLayout) {
    const component = this.definitions.get(id);
    if (!component) throw new Error(`unknown chat layout: ${id}`);
    this.snapshot = { id, component };
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
