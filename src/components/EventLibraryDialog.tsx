import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ImageIcon, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchEventImageLibrary, type EventLibraryImage } from "@/api/event/eventApi";
import { cn } from "@/lib/utils";
import catacapLogo from "@assets/CataCap-Logo.png";

interface EventLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (image: EventLibraryImage) => void;
}

export function EventLibraryDialog({ open, onOpenChange, onSelect }: EventLibraryDialogProps) {
  const [selected, setSelected] = useState<EventLibraryImage | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["event-image-library"],
    queryFn: fetchEventImageLibrary,
    enabled: open,
    staleTime: 30_000,
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) setSelected(null);
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  };

  const images = data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col" data-testid="dialog-event-library">
        <DialogHeader>
          <DialogTitle>Event Library</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground" data-testid="event-library-loading">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading images…</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-destructive">
              <p>Failed to load event images.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground" data-testid="event-library-empty">
              <ImageIcon className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm font-medium">No event images yet</p>
              <p className="text-xs mt-1">Upload an image on an event to add it to the library.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {images.map((img) => {
                const isSelected = selected?.imageFileName === img.imageFileName;
                return (
                  <button
                    type="button"
                    key={img.imageFileName}
                    onClick={() => setSelected(img)}
                    onDoubleClick={() => {
                      setSelected(img);
                      onSelect(img);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "group relative aspect-square rounded-md overflow-hidden border-2 transition-all bg-muted/20 hover:border-primary/60",
                      isSelected ? "border-primary ring-2 ring-primary/40" : "border-transparent"
                    )}
                    title={img.eventTitle}
                    data-testid={`event-library-item-${img.eventId ?? img.imageFileName}`}
                  >
                    <img
                      src={img.url}
                      alt={img.eventTitle}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = catacapLogo;
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded border-2 transition-all shadow-sm",
                        isSelected
                          ? "bg-primary border-primary text-white"
                          : "bg-white/90 border-white/90 text-transparent group-hover:border-primary/60"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    {isSelected && (
                      <span className="absolute inset-0 bg-primary/10 pointer-events-none" />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                      <p className="text-[11px] text-white truncate">{img.eventTitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-event-library-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected}
            data-testid="button-event-library-confirm"
          >
            Use selected image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
