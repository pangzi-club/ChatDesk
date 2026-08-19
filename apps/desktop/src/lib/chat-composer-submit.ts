export type ComposerEnterAction = "submit" | "queue" | "follow-up";

export function resolveComposerEnterAction(options: {
  isGenerating: boolean;
  metaKey: boolean;
}): ComposerEnterAction {
  if (!options.isGenerating) return "submit";
  return options.metaKey ? "follow-up" : "queue";
}
