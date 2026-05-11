import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface SelectedAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Data: string;
}

interface AttachmentsPickerProps {
  attachments: SelectedAttachment[];
  onChange: (attachments: SelectedAttachment[]) => void;
  disabled?: boolean;
  dataTestId?: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ACCEPT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
].join(",");

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file."));
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function AttachmentsPicker({
  attachments,
  onChange,
  disabled,
  dataTestId,
}: AttachmentsPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const triggerFilePicker = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const accepted: SelectedAttachment[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${file.name} (${formatBytes(file.size)})`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        accepted.push({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          base64Data: dataUrl,
        });
      } catch {
        rejected.push(file.name);
      }
    }

    if (rejected.length > 0) {
      toast({
        title: "Some files were not added",
        description: `Files exceeding 10MB or unreadable: ${rejected.join(", ")}`,
        variant: "destructive",
        duration: 5000,
      });
    }

    if (accepted.length > 0) {
      onChange([...attachments, ...accepted]);
    }
  };

  const removeAt = (index: number) => {
    const next = attachments.slice();
    next.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="space-y-2 pt-2 w-full min-w-0" data-testid={dataTestId}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-sm text-muted-foreground min-w-0 truncate">Attachments (optional, max 10MB per file)</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs shrink-0"
          onClick={triggerFilePicker}
          disabled={disabled}
          data-testid={dataTestId ? `${dataTestId}-add` : undefined}
        >
          <Paperclip className="h-3.5 w-3.5 mr-1.5" />
          Add files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_TYPES}
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
          }}
          data-testid={dataTestId ? `${dataTestId}-input` : undefined}
        />
      </div>
      {attachments.length > 0 && (
        <ul className="space-y-1.5 max-h-[160px] overflow-y-auto w-full min-w-0">
          {attachments.map((att, idx) => (
            <li
              key={`${att.fileName}-${idx}`}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 text-sm w-full min-w-0"
              data-testid={dataTestId ? `${dataTestId}-item-${idx}` : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" title={att.fileName}>{att.fileName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatBytes(att.sizeBytes)}</span>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeAt(idx)}
                disabled={disabled}
                data-testid={dataTestId ? `${dataTestId}-remove-${idx}` : undefined}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
