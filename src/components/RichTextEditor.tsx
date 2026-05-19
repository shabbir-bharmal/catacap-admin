import { useRef, useCallback, useEffect, useState } from "react";
import Quill from "quill";
import type { Delta as DeltaType, EmitterSource, Parchment, Range } from "quill";
import { Mention } from "quill-mention";

// quill-mention's bare import only re-exports classes; we must register the
// module ourselves. We deliberately omit its default MentionBlot because we
// register our own `MentionChipBlot` below to keep legacy `{Key}` chip parity.
Quill.register({ "modules/mention": Mention }, true);

import {
  Bold,
  Italic,
  Underline,
  Link as LinkIcon,
  List,
  ListOrdered,
  RemoveFormatting,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
  suggestions?: { id: number; key?: string; value: string }[];
  maxLength?: number;
}

interface MentionData {
  id?: string | number;
  value?: string;
  key?: string;
  denotationChar?: string;
  [extra: string]: unknown;
}

const MENTION_CLASS_NAME =
  "bg-sky-100 text-sky-900 rounded-md px-1.5 py-0.5 inline-block mx-0.5 font-medium select-none";

function isSafeHref(href: string): boolean {
  const trimmed = (href || "").trim();
  if (!trimmed) return false;
  return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(trimmed);
}

// Quill 2.0 emits both bullet and numbered lists as <ol>, marking each <li>
// with a non-standard `data-list="bullet"` / `data-list="ordered"` attribute
// plus a `<span class="ql-ui">` filler. Inside the editor it looks correct
// (Quill styles `li[data-list="bullet"]` with bullets) but the persisted
// HTML is not standards-compliant: when rendered outside Quill (FAQ page,
// emails, exports) the browser treats <ol> as a numbered list and the
// bullets disappear. Normalize the emitted HTML to use <ul>/<ol> properly.
function normalizeQuillListHtml(html: string): string {
  if (!html || (html.indexOf("<ol") === -1 && html.indexOf("ql-ui") === -1)) {
    return html;
  }
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}</body>`,
    "text/html",
  );

  // Strip Quill's `<span class="ql-ui" contenteditable="false"></span>` filler
  // spans that live inside list items.
  doc.querySelectorAll("li > span.ql-ui").forEach((span) => {
    span.parentNode?.removeChild(span);
  });

  // Convert any <ol> whose <li> children are all bullet items into a <ul>.
  // Leave ordered/mixed/unknown lists as <ol>.
  doc.querySelectorAll("ol").forEach((ol) => {
    const items = Array.from(ol.children).filter(
      (c) => c.tagName === "LI",
    ) as HTMLLIElement[];
    if (items.length === 0) return;
    const allBullet = items.every(
      (li) => li.getAttribute("data-list") === "bullet",
    );
    if (allBullet) {
      const ul = doc.createElement("ul");
      for (const attr of Array.from(ol.attributes)) {
        ul.setAttribute(attr.name, attr.value);
      }
      while (ol.firstChild) ul.appendChild(ol.firstChild);
      ol.parentNode?.replaceChild(ul, ol);
    }
  });

  // Drop the `data-list` attribute on all <li> elements once the wrapper
  // tag conveys the list type.
  doc.querySelectorAll("li[data-list]").forEach((li) => {
    li.removeAttribute("data-list");
  });

  return doc.body.innerHTML;
}

const Delta = Quill.import("delta") as typeof DeltaType;
const Embed = Quill.import("blots/embed") as typeof Parchment.EmbedBlot;

class MentionChipBlot extends Embed {
  static blotName = "mention";
  static tagName = "SPAN";
  static className = "bg-sky-100";

  static create(data: MentionData = {}): HTMLElement {
    const node = super.create() as HTMLElement;
    const key = String(data.key ?? data.value ?? "");
    node.setAttribute("class", MENTION_CLASS_NAME);
    node.setAttribute("contenteditable", "false");
    if (data.id != null) node.setAttribute("data-id", String(data.id));
    if (data.value != null) node.setAttribute("data-value", String(data.value));
    node.setAttribute("data-key", key);
    node.setAttribute(
      "data-denotation-char",
      data.denotationChar ? String(data.denotationChar) : "@",
    );
    node.textContent = `{${key}}`;
    return node;
  }

  static value(node: HTMLElement): MentionData {
    const text = (node.textContent || "").trim();
    const match = text.match(/^\{(.+)\}$/);
    const fallback = match ? match[1] : text;
    return {
      id: node.getAttribute("data-id") ?? fallback,
      value: node.getAttribute("data-value") ?? fallback,
      key: node.getAttribute("data-key") ?? fallback,
      denotationChar: node.getAttribute("data-denotation-char") ?? "@",
    };
  }

  constructor(scroll: Parchment.ScrollBlot, node: Node) {
    super(scroll, node);
  }

  length() {
    return 1;
  }
}

Quill.register(MentionChipBlot, true);

interface QuillLinkFormat {
  PROTOCOL_WHITELIST: string[];
  sanitize(url: string): string;
}

const LinkFormat = Quill.import("formats/link") as QuillLinkFormat;
LinkFormat.PROTOCOL_WHITELIST = ["http", "https", "mailto", "tel"];
const originalSanitize = LinkFormat.sanitize.bind(LinkFormat);
LinkFormat.sanitize = function sanitize(url: string): string {
  if (!isSafeHref(url)) return "about:blank";
  return originalSanitize(url);
};

type FormatRecord = Record<string, unknown>;

export function RichTextEditor({
  value,
  onChange,
  placeholder = "",
  className = "",
  "data-testid": testId,
  suggestions = [],
  maxLength,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const onChangeRef = useRef(onChange);
  const suggestionsRef = useRef(suggestions);
  const maxLengthRef = useRef(maxLength);
  const lastValidContentsRef = useRef<DeltaType | null>(null);
  const lastEmittedValueRef = useRef<string>(value);
  const isInternalUpdateRef = useRef(false);

  const [activeFormats, setActiveFormats] = useState<FormatRecord>({});

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    maxLengthRef.current = maxLength;
  }, [maxLength]);

  // Initialize Quill once
  useEffect(() => {
    if (!editorRef.current || quillRef.current) return;

    const quill = new Quill(editorRef.current, {
      theme: "snow",
      placeholder,
      formats: ["bold", "italic", "underline", "link", "list", "mention"],
      modules: {
        toolbar: false,
        clipboard: { matchVisual: false },
        mention: {
          isolateCharacter: true,
          mentionDenotationChars: ["@"],
          allowedChars: /^[^\s]*$/,
          blotName: "mention",
          dataAttributes: ["id", "value", "key", "denotationChar"],
          spaceAfterInsert: true,
          positioningStrategy: "fixed",
          source: (
            searchTerm: string,
            renderList: (
              matches: { id: string; value: string; [key: string]: string | undefined }[],
              searchTerm: string,
            ) => void,
          ) => {
            const items = suggestionsRef.current || [];
            const term = (searchTerm || "").toLowerCase();
            const matches = items
              .filter((s) =>
                ((s.key || s.value) || "").toLowerCase().includes(term),
              )
              .map((s) => ({
                id: String(s.id),
                value: s.value,
                key: s.key || s.value,
                denotationChar: "@",
              }));
            renderList(matches, searchTerm);
          },
          renderItem: (item: { id: string; value: string; [key: string]: unknown }) => {
            const span = document.createElement("span");
            const key = item.key as string | undefined;
            span.textContent = key || item.value || "";
            return span;
          },
        },
      },
    });

    quillRef.current = quill;

    // Drop link formatting from pasted anchors with unsafe protocols so the
    // text content survives but no <a> wrapper is emitted (avoids creating
    // visible "about:blank" anchors via Quill's link sanitize fallback).
    quill.clipboard.addMatcher("A", (node: Node, delta: DeltaType) => {
      if (!(node instanceof HTMLElement)) return delta;
      const href = node.getAttribute("href") || "";
      if (!isSafeHref(href)) {
        const stripped = new Delta();
        delta.ops.forEach((op) => {
          if (op.attributes && op.attributes.link) {
            const { link: _link, ...rest } = op.attributes;
            stripped.push({
              insert: op.insert,
              ...(Object.keys(rest).length > 0 ? { attributes: rest } : {}),
            });
          } else {
            stripped.push(op);
          }
        });
        return stripped;
      }
      return delta;
    });

    // Recognize legacy mention chip spans on paste / dangerouslyPasteHTML.
    quill.clipboard.addMatcher("SPAN", (node: Node, delta: DeltaType) => {
      if (!(node instanceof HTMLElement)) return delta;
      // Match the legacy chip span as narrowly as possible: the full set of
      // styling classes from the previous editor PLUS the `{Key}` text shape.
      // This avoids false positives on unrelated spans that happen to share a
      // sky-blue/text class.
      const text = (node.textContent || "").trim();
      const match = text.match(/^\{(.+)\}$/);
      if (
        match &&
        node.classList.contains("bg-sky-100") &&
        node.classList.contains("text-sky-900") &&
        node.classList.contains("select-none")
      ) {
        const key = match[1];
        return new Delta().insert({
          mention: {
            id: node.getAttribute("data-id") ?? key,
            value: node.getAttribute("data-value") ?? key,
            key: node.getAttribute("data-key") ?? key,
            denotationChar:
              node.getAttribute("data-denotation-char") ?? "@",
          },
        });
      }
      return delta;
    });

    // Initial value
    if (value) {
      quill.clipboard.dangerouslyPasteHTML(value, "silent");
    }
    lastValidContentsRef.current = quill.getContents();
    lastEmittedValueRef.current = normalizeQuillListHtml(quill.root.innerHTML);

    // Mirror the consumer-side `stripHtml(html).length` counter (e.g. in
    // RaiseMoney / AdminInvestmentEdit). `stripHtml` removes tags but does
    // NOT introduce line breaks at block boundaries, so we drop newlines
    // from Quill's text ops and expand mention chips back to `{key}` text.
    const getPlainTextLength = () => {
      let total = 0;
      quill.getContents().ops.forEach((op) => {
        if (typeof op.insert === "string") {
          total += op.insert.replace(/\n/g, "").length;
        } else if (op.insert && typeof op.insert === "object") {
          const embed = op.insert as Record<string, unknown>;
          if (embed.mention) {
            const m = embed.mention as MentionData;
            const key = String(m.key ?? m.value ?? "");
            total += key.length + 2; // `{` + key + `}`
          } else {
            total += 1;
          }
        }
      });
      return total;
    };

    quill.on(
      "text-change",
      (_delta: DeltaType, _oldDelta: DeltaType, source: EmitterSource) => {
        if (source === "silent") return;

        const limit = maxLengthRef.current;
        if (limit && getPlainTextLength() > limit) {
          if (lastValidContentsRef.current) {
            isInternalUpdateRef.current = true;
            quill.setContents(lastValidContentsRef.current, "silent");
            isInternalUpdateRef.current = false;
            const len = quill.getLength();
            quill.setSelection(Math.max(0, len - 1), 0, "silent");
          }
          return;
        }

        lastValidContentsRef.current = quill.getContents();
        // Quill emits `<p><br></p>` for an empty editor. The legacy editor
        // emitted `""`, and several consumers persist the raw value, so
        // normalize empty content to keep behavior identical.
        const isEmpty =
          quill.getLength() <= 1 &&
          quill.getText() === "\n" &&
          !lastValidContentsRef.current.ops.some(
            (op) => op.insert && typeof op.insert === "object",
          );
        const html = isEmpty ? "" : normalizeQuillListHtml(quill.root.innerHTML);
        lastEmittedValueRef.current = html;
        onChangeRef.current(html);
      },
    );

    quill.on("selection-change", (range: Range | null) => {
      if (!range) {
        setActiveFormats({});
        return;
      }
      setActiveFormats(quill.getFormat(range) as FormatRecord);
    });

    return () => {
      quillRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes when the editor isn't focused
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    if (isInternalUpdateRef.current) return;
    if (value === lastEmittedValueRef.current) return;
    // Old records may persist the pre-normalization `<ol data-list="bullet">`
    // shape. After we paste them into Quill they'll emit as `<ul>`, which
    // would otherwise trigger an infinite sync loop. Compare normalized
    // forms so historical values are treated as already in sync.
    if (normalizeQuillListHtml(value) === lastEmittedValueRef.current) return;
    if (quill.hasFocus()) return;

    isInternalUpdateRef.current = true;
    quill.setContents(new Delta(), "silent");
    if (value) {
      quill.clipboard.dangerouslyPasteHTML(value, "silent");
    }
    lastValidContentsRef.current = quill.getContents();
    lastEmittedValueRef.current = normalizeQuillListHtml(quill.root.innerHTML);
    isInternalUpdateRef.current = false;
  }, [value]);

  // Update placeholder when prop changes
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.root.setAttribute("data-placeholder", placeholder || "");
  }, [placeholder]);

  const formatToggle = useCallback(
    (format: string, value: string | boolean = true) => {
      const quill = quillRef.current;
      if (!quill) return;
      quill.focus();
      const range = quill.getSelection(true);
      if (!range) return;
      const current = quill.getFormat(range) as FormatRecord;
      if (format === "list") {
        const isActive = current.list === value;
        quill.format("list", isActive ? false : value, "user");
      } else {
        quill.format(format, current[format] ? false : value, "user");
      }
      setActiveFormats(quill.getFormat() as FormatRecord);
    },
    [],
  );

  const handleLink = useCallback(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.focus();
    const range = quill.getSelection(true);
    if (!range) return;
    const current = quill.getFormat(range) as FormatRecord;
    if (current.link) {
      quill.format("link", false, "user");
      setActiveFormats(quill.getFormat() as FormatRecord);
      return;
    }
    // Use Quill's built-in snow-theme link tooltip rather than window.prompt
    // so users see an inline editor instead of the ugly browser dialog.
    const theme = (quill as unknown as {
      theme?: {
        tooltip?: {
          edit: (mode: string, preview?: string | null) => void;
          save?: () => void;
        };
      };
    }).theme;
    const tooltip = theme?.tooltip;
    if (tooltip && typeof tooltip.edit === "function") {
      tooltip.edit("link", typeof current.link === "string" ? current.link : "");
      return;
    }
    // Fallback if the snow tooltip isn't available for any reason.
    const url = prompt("Enter URL:");
    if (!url) return;
    if (!isSafeHref(url)) return;
    if (range.length === 0) {
      quill.insertText(range.index, url, { link: url }, "user");
      quill.setSelection(range.index + url.length, 0, "user");
    } else {
      quill.format("link", url, "user");
    }
    setActiveFormats(quill.getFormat() as FormatRecord);
  }, []);

  const handleClearFormatting = useCallback(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.focus();
    const range = quill.getSelection(true);
    const target =
      range && range.length > 0
        ? range
        : { index: 0, length: quill.getLength() };
    // quill.removeFormat() also strips embeds (mention chips); build an
    // updateContents delta instead so chips survive clear-format.
    const contents = quill.getContents(target.index, target.length);
    const update = new Delta().retain(target.index);
    contents.ops.forEach((op) => {
      if (typeof op.insert === "string") {
        update.retain(op.insert.length, {
          bold: null,
          italic: null,
          underline: null,
          link: null,
          list: null,
        });
      } else if (op.insert != null) {
        update.retain(1);
      }
    });
    quill.updateContents(update, "user");
    setActiveFormats(quill.getFormat() as FormatRecord);
  }, []);

  const isActive = (format: string, value: string | boolean = true) => {
    const v = activeFormats[format];
    if (format === "list") return v === value;
    return Boolean(v);
  };

  const toolbarButtons: Array<{
    icon: typeof Bold;
    label: string;
    testId: string;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      icon: Bold,
      label: "Bold",
      testId: "button-bold",
      active: isActive("bold"),
      onClick: () => formatToggle("bold"),
    },
    {
      icon: Italic,
      label: "Italic",
      testId: "button-italic",
      active: isActive("italic"),
      onClick: () => formatToggle("italic"),
    },
    {
      icon: Underline,
      label: "Underline",
      testId: "button-underline",
      active: isActive("underline"),
      onClick: () => formatToggle("underline"),
    },
    {
      icon: LinkIcon,
      label: "Link",
      testId: "button-link",
      active: isActive("link"),
      onClick: handleLink,
    },
    {
      icon: ListOrdered,
      label: "Ordered List",
      testId: "button-ordered-list",
      active: isActive("list", "ordered"),
      onClick: () => formatToggle("list", "ordered"),
    },
    {
      icon: List,
      label: "Unordered List",
      testId: "button-unordered-list",
      active: isActive("list", "bullet"),
      onClick: () => formatToggle("list", "bullet"),
    },
    {
      icon: RemoveFormatting,
      label: "Clear Formatting",
      testId: "button-clear-format",
      active: false,
      onClick: handleClearFormatting,
    },
  ];

  return (
    <div
      className={cn("border rounded-md overflow-hidden bg-white dark:bg-background", className)}
      data-testid={testId}
    >
      <div
        className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-muted/40"
        data-testid="rich-text-toolbar"
      >
        {toolbarButtons.map((btn) => (
          <Button
            key={btn.testId}
            type="button"
            size="icon"
            variant="ghost"
            className={cn("h-7 w-7", btn.active && "bg-accent")}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={(e) => {
              e.preventDefault();
              btn.onClick();
            }}
            title={btn.label}
            data-testid={btn.testId}
          >
            <btn.icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>

      <div
        ref={editorRef}
        dir="ltr"
        className="rich-text-editor-content"
        data-testid={testId ? `${testId}-editor` : "rich-text-content"}
      />
    </div>
  );
}
