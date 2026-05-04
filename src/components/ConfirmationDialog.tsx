import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string | React.ReactNode;
  description?: React.ReactNode;
  noteValue?: string;
  onNoteChange?: (value: string) => void;
  notePlaceholder?: string;
  noteLabel?: string;
  maxNoteLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isSubmitting?: boolean;
  confirmButtonClass?: string;
  children?: React.ReactNode;
  dataTestId?: string;
  contentClassName?: string;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  noteValue,
  onNoteChange,
  notePlaceholder = "Enter notes for this status change...",
  noteLabel,
  maxNoteLength = 1000,
  confirmLabel = "YES",
  cancelLabel = "NO",
  onConfirm,
  isSubmitting = false,
  confirmButtonClass,
  children,
  dataTestId,
  contentClassName,
}: ConfirmationDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isSubmitting) {
          onOpenChange(isOpen);
        }
      }}
    >
      <DialogContent className={cn("sm:w-[480px]", contentClassName)} data-testid={dataTestId}>
        <div className="text-base font-semibold py-2">
          {title}
        </div>
        
        {description && (
          <div className="text-sm text-muted-foreground mb-4">
            {description}
          </div>
        )}

        {onNoteChange && (
          <div className="space-y-1.5 mb-2">
            {noteLabel && <p className="text-sm text-muted-foreground">{noteLabel}</p>}
            <Textarea
              placeholder={notePlaceholder}
              value={noteValue || ""}
              onChange={(e) => {
                if (e.target.value.length <= maxNoteLength) onNoteChange(e.target.value);
              }}
              className="min-h-[120px] resize-none"
              data-testid={dataTestId ? `${dataTestId}-note` : undefined}
            />
            {maxNoteLength > 0 && (
              <p className="text-xs text-muted-foreground text-right">
                {noteValue?.length || 0}/{maxNoteLength}
              </p>
            )}
          </div>
        )}

        {children}

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            data-testid={dataTestId ? `${dataTestId}-no` : undefined}
          >
            {cancelLabel}
          </Button>
          <Button
            className={cn(confirmButtonClass, "min-w-[70px]")}
            onClick={onConfirm}
            disabled={isSubmitting || (onNoteChange && !noteValue?.trim())}
            data-testid={dataTestId ? `${dataTestId}-yes` : undefined}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
