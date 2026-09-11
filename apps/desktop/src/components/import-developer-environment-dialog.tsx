import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ImportDeveloperEnvironmentDialogProps = {
  /** Icon shown on the confirm action while idle. */
  confirmIcon?: ReactNode;
  description: string;
  /** Error to surface inside the dialog, or `null`/`undefined` for none. */
  errorMessage?: string | null;
  isPending: boolean;
  /** Runs the page-owned import mutation. */
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

/**
 * Shared confirmation for importing local developer tool paths from the login
 * shell. The owning page passes its own copy, pending/error state, and
 * mutation so route-specific state stays out of the component.
 */
export function ImportDeveloperEnvironmentDialog({
  confirmIcon,
  description,
  errorMessage,
  isPending,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ImportDeveloperEnvironmentDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage ? (
          <p className="text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? <LoaderCircle className="size-4 animate-spin" /> : confirmIcon}
            确认导入
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
