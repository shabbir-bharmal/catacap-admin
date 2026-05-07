import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, Save, ChevronLeft, ChevronRight, ImageIcon, Lock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    fetchGroupInvestments,
    updateGroupInvestments,
    GroupInvestmentCampaign,
} from "@/api/group/groupApi";

interface GroupInvestmentsSectionProps {
    apiGroupId: number | null;
    cardClassName?: string;
}

export function GroupInvestmentsSection({ apiGroupId, cardClassName }: GroupInvestmentsSectionProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedCampaigns, setSelectedCampaigns] = useState<GroupInvestmentCampaign[]>([]);
    const [availableCampaigns, setAvailableCampaigns] = useState<GroupInvestmentCampaign[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [initialIds, setInitialIds] = useState<Set<number>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");

    const loadData = useCallback(async () => {
        if (!apiGroupId) return;
        setLoading(true);
        try {
            const data = await fetchGroupInvestments(apiGroupId);
            setSelectedCampaigns(data.groupCampaigns);
            setInitialIds(
                new Set(
                    data.groupCampaigns
                        .filter((c) => !c.isPrivateAccess)
                        .map((c) => c.id)
                )
            );
            setAvailableCampaigns(data.publicCampaigns);
            setCurrentPage(1);
        } catch {
            toast({ title: "Failed to load investments", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [apiGroupId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleAdd = (campaign: GroupInvestmentCampaign) => {
        setSelectedCampaigns((prev) => [...prev, campaign]);
        setAvailableCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    };

    const handleRemove = (campaign: GroupInvestmentCampaign) => {
        setSelectedCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
        setAvailableCampaigns((prev) => [...prev, campaign].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const handleSave = async () => {
        if (!apiGroupId) return;
        setSaving(true);
        try {
            const ids = selectedCampaigns
                .filter((c) => !c.isPrivateAccess)
                .map((c) => c.id);
            await updateGroupInvestments(apiGroupId, ids);
            setInitialIds(new Set(ids));
            toast({ title: "Investments updated", description: "Group investments have been saved successfully." });
            await loadData();
        } catch {
            toast({ title: "Failed to save investments", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = useCallback(
        (c: GroupInvestmentCampaign) =>
            normalizedSearch === "" ||
            (c.name || "").toLowerCase().includes(normalizedSearch),
        [normalizedSearch]
    );

    const filteredSelected = useMemo(
        () => selectedCampaigns.filter(matchesSearch),
        [selectedCampaigns, matchesSearch]
    );
    const filteredAvailable = useMemo(
        () => availableCampaigns.filter(matchesSearch),
        [availableCampaigns, matchesSearch]
    );

    const totalAvailable = filteredAvailable.length;
    const totalAvailableAll = availableCampaigns.length;
    const totalPages = Math.max(1, Math.ceil(totalAvailable / pageSize));
    const paginatedAvailable = filteredAvailable.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    useEffect(() => {
        setCurrentPage(1);
    }, [normalizedSearch]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(Math.max(1, totalPages));
        }
    }, [totalPages, currentPage]);

    const editableSelected = selectedCampaigns.filter((c) => !c.isPrivateAccess);
    const hasChanges =
        editableSelected.length !== initialIds.size ||
        editableSelected.some((c) => !initialIds.has(c.id));

    if (loading) {
        return (
            <Card className={cardClassName}>
                <CardContent className="p-5 sm:p-6 flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={cardClassName}>
            <CardContent className="p-5 sm:p-6 space-y-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search investments by name..."
                        className="pl-9 pr-9"
                        data-testid="input-search-investments"
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                            aria-label="Clear search"
                            data-testid="button-clear-search-investments"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <div>
                    <h5 className="text-base font-semibold" data-testid="text-selected-investments-heading">
                        Selected Investments ({filteredSelected.length}
                        {normalizedSearch ? ` of ${selectedCampaigns.length}` : ""})
                    </h5>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        These investments are currently assigned to this group.
                    </p>
                </div>

                {filteredSelected.length > 0 ? (
                    <div className="space-y-2">
                        {filteredSelected.map((campaign) => (
                            <CampaignRow
                                key={campaign.id}
                                campaign={campaign}
                                action={campaign.isPrivateAccess ? "none" : "remove"}
                                onAction={() => handleRemove(campaign)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 text-muted-foreground">
                        <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">
                            {normalizedSearch
                                ? "No selected investments match your search."
                                : "No investments selected yet."}
                        </p>
                    </div>
                )}

                <div className="border-t pt-6">
                    <div className="flex items-center justify-between gap-4 mb-3">
                        <div>
                            <h5 className="text-base font-semibold" data-testid="text-available-investments-heading">
                                Available Investments ({totalAvailable}
                                {normalizedSearch ? ` of ${totalAvailableAll}` : ""})
                            </h5>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Add investments to this group from the list below.
                            </p>
                        </div>
                    </div>

                    {paginatedAvailable.length > 0 ? (
                        <div className="space-y-2">
                            {paginatedAvailable.map((campaign) => (
                                <CampaignRow
                                    key={campaign.id}
                                    campaign={campaign}
                                    action="add"
                                    onAction={() => handleAdd(campaign)}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-muted-foreground">
                            <p className="text-sm">
                                {normalizedSearch
                                    ? "No available investments match your search."
                                    : "No available investments."}
                            </p>
                        </div>
                    )}

                    {totalAvailable > 0 && (
                        <div className="flex items-center justify-between mt-4 pt-3 border-t">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>Show</span>
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    className="border border-border rounded px-2 py-1 text-sm bg-background"
                                    data-testid="select-page-size"
                                >
                                    {[5, 10, 20, 50].map((size) => (
                                        <option key={size} value={size}>{size}</option>
                                    ))}
                                </select>
                                <span>per page</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={currentPage <= 1}
                                    onClick={() => setCurrentPage((p) => p - 1)}
                                    data-testid="button-prev-page"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setCurrentPage((p) => p + 1)}
                                    data-testid="button-next-page"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="pt-2 flex justify-end">
                    <Button
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                        className="bg-[#405189] hover:bg-[#405189]/90"
                        data-testid="button-save-investments"
                    >
                        {saving ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                Save Investments
                            </>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function CampaignRow({
    campaign,
    action,
    onAction,
}: {
    campaign: GroupInvestmentCampaign;
    action: "add" | "remove" | "none";
    onAction: () => void;
}) {
    const imgSrc = campaign.imageFileName || null;

    return (
        <div
            className="flex items-center justify-between gap-3 p-3 rounded-md border border-border hover:bg-muted/20 transition-colors"
            data-testid={`row-investment-${campaign.id}`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-10 w-10 rounded-md flex-shrink-0">
                    {imgSrc ? (
                        <AvatarImage src={imgSrc} alt={campaign.name} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="rounded-md bg-muted text-muted-foreground text-xs">
                        <ImageIcon className="w-4 h-4" />
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{campaign.name}</p>
                        {campaign.isPrivateAccess && (
                            <Badge
                                variant="secondary"
                                className="shrink-0 gap-1 text-[10px] px-1.5 py-0"
                                data-testid={`badge-private-access-${campaign.id}`}
                            >
                                <Lock className="w-3 h-3" />
                                Private Access
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">{campaign.stageLabel}</p>
                </div>
            </div>
            {action !== "none" && (
                <Button
                    variant={action === "add" ? "outline" : "destructive"}
                    size="sm"
                    className={
                        action === "add"
                            ? "border-[#405189] text-[#405189] hover:bg-[#405189]/10 shrink-0"
                            : "shrink-0"
                    }
                    onClick={onAction}
                    data-testid={`button-${action}-investment-${campaign.id}`}
                >
                    {action === "add" ? (
                        <>
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            ADD
                        </>
                    ) : (
                        <>
                            <X className="w-3.5 h-3.5 mr-1" />
                            REMOVE
                        </>
                    )}
                </Button>
            )}
        </div>
    );
}
