import { cn } from "@/lib/utils";

export function RequiredMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("ml-0.5 text-destructive font-semibold", className)}
    >
      *
    </span>
  );
}

export function FieldError({
  message,
  show,
  className,
  testId,
}: {
  message: string;
  show: boolean;
  className?: string;
  testId?: string;
}) {
  if (!show) return null;
  return (
    <p
      className={cn("text-xs text-destructive font-medium", className)}
      data-testid={testId}
    >
      {message}
    </p>
  );
}
