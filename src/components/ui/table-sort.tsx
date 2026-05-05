import React from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortIconProps {
    field: string;
    sortField: string | null;
    sortDir: "asc" | "desc" | null;
}

export const SortIcon = ({ field, sortField, sortDir }: SortIconProps) => {
    if (sortField === field && sortDir === "asc") {
        return <ArrowUp className="h-3 w-3 shrink-0 text-foreground" />;
    }
    if (sortField === field && sortDir === "desc") {
        return <ArrowDown className="h-3 w-3 shrink-0 text-foreground" />;
    }
    return <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />;
};

export interface SortHeaderProps {
    field: string;
    sortField: string | null;
    sortDir: "asc" | "desc" | null;
    handleSort: (field: any) => void;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const SortHeader = ({
    field,
    sortField,
    sortDir,
    handleSort,
    children,
    className,
    style,
}: SortHeaderProps) => {
    const isCentered = className?.includes("text-center");

    return (
        <th
            className={cn(
                "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none",
                className
            )}
            onClick={() => handleSort(field)}
            data-testid={`sort-${field}`}
            style={style}
        >
            <span className={cn("inline-flex items-center gap-1", isCentered && "justify-center w-full")}>
                {children}
                <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
            </span>
        </th>
    );
};
