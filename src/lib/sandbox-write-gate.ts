type WriteRequest = {
  id: string;
  path: string;
  content: string;
};

type WriteListener = (request: WriteRequest | null) => void;

/**
 * Bridges sandboxed write_file tool execution with the UI approval strip.
 * The tool awaits a Promise that the page resolves when the user allows/denies.
 */
export function createSandboxWriteGate() {
  let request: WriteRequest | null = null;
  let resolver: ((approved: boolean) => void) | null = null;
  const listeners = new Set<WriteListener>();

  function emit() {
    for (const listener of listeners) {
      listener(request);
    }
  }

  function clearPending(approved: boolean) {
    const current = resolver;
    request = null;
    resolver = null;
    emit();
    current?.(approved);
  }

  return {
    getRequest(): WriteRequest | null {
      return request;
    },
    waitForApproval(path: string, content: string): Promise<boolean> {
      return new Promise((resolve) => {
        if (resolver) {
          clearPending(false);
        }
        request = {
          id: crypto.randomUUID(),
          path,
          content,
        };
        resolver = resolve;
        emit();
      });
    },
    respond(id: string, approved: boolean) {
      if (!request || request.id !== id || !resolver) return;
      clearPending(approved);
    },
    subscribe(listener: WriteListener) {
      listeners.add(listener);
      listener(request);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SandboxWriteGate = ReturnType<typeof createSandboxWriteGate>;
export type SandboxWriteRequest = WriteRequest;
