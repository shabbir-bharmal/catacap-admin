import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, ListPlus, Upload, X, Bold, Italic, Underline, Link as LinkIcon, List, ListOrdered, Strikethrough } from "lucide-react";
import { getUrlBlobContainerImage, defaultImage, catacapDefaultImageLogo } from "@/lib/image-utils";
import { Switch } from "@/components/ui/switch";
import {
  fetchSourcedBy,
  fetchThemes,
  fetchSpecialFilters,
  fetchStaticValues,
  fetchConfigurations,
  fetchTransactionTypes,
  fetchInvestmentTypeCategories,
  fetchNewsTypes,
  fetchNewsAudiences,
  fetchStatistics,
  fetchMetaInformation,
  fetchContactInfo,
  fetchDAFProviders,
  toggleDAFProviderActive,
  deleteSiteConfigItem,
  saveSiteConfigItem,
  fetchConfigItemInvestments,
  toggleConfigItemInvestment,
  SourcedByItem,
  ThemeItem,
  SpecialFilterItem,
  StaticValueItem,
  TransactionTypeItem,
  InvestmentTypeCategoryItem,
  NewsTypeItem,
  NewsAudienceItem,
  StatisticsItem,
  MetaInformationItem,
  ContactInfoItem,
  DAFProviderItem,
  SiteConfigType,
  SiteConfigSavePayload,
  ConfigItemInvestment
} from "../api/site-configuration/siteConfigurationApi";

const TABS = ["Sourced By", "Themes", "Special Filters", "Configuration", "Contact Info", "Transaction Type", "Investment Type", "News Type", "News Audience", "Statistics", "Meta Information", "DAF Providers"] as const;

const CONTACT_INFO_SECTIONS = [
  { key: "emails", label: "Emails" },
  { key: "people", label: "People" },
  { key: "organization", label: "Organization" },
] as const;

type TabKey = (typeof TABS)[number];

export default function SiteConfiguration() {
  const { hasActionPermission } = useAuth();
  const STORAGE_KEY = "siteConfig_activeTab";
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as TabKey | null;
    return saved && (TABS as readonly string[]).includes(saved) ? saved : "Sourced By";
  });

  const [sourcedBy, setSourcedBy] = useState<SourcedByItem[]>([]);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [specialFilters, setSpecialFilters] = useState<SpecialFilterItem[]>([]);
  const [staticValues, setStaticValues] = useState<(StaticValueItem & { configType: SiteConfigType })[]>([]);
  const [configurations, setConfigurations] = useState<(StaticValueItem & { configType: SiteConfigType })[]>([]);
  const [transactionTypes, setTransactionTypes] = useState<TransactionTypeItem[]>([]);
  const [investmentTypeCategories, setInvestmentTypeCategories] = useState<InvestmentTypeCategoryItem[]>([]);
  const [newsTypes, setNewsTypes] = useState<NewsTypeItem[]>([]);
  const [newsAudiences, setNewsAudiences] = useState<NewsAudienceItem[]>([]);
  const [statistics, setStatistics] = useState<StatisticsItem[]>([]);
  const [metaInformation, setMetaInformation] = useState<MetaInformationItem[]>([]);
  const [contactInfo, setContactInfo] = useState<ContactInfoItem[]>([]);
  const [dafProviders, setDafProviders] = useState<DAFProviderItem[]>([]);
  const [togglingDafId, setTogglingDafId] = useState<number | string | null>(null);

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const loadedTabsRef = useRef<Set<TabKey>>(new Set());
  const [retryToken, setRetryToken] = useState(0);

  const { toast } = useToast();
  const editorRef = useRef<HTMLDivElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: number | string | null; field1: string; field2: string; field3: string; imagePreview: string; imageFileName: string; configType?: SiteConfigType }>({
    id: null,
    field1: "",
    field2: "",
    field3: "",
    imagePreview: "",
    imageFileName: "",
    configType: undefined
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number | string; name: string; configType: SiteConfigType } | null>(null);

  useEffect(() => {
    if (loadedTabsRef.current.has(activeTab)) {
      setLoading(false);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    (async () => {
      try {
        switch (activeTab) {
          case "Sourced By": {
            const data = await fetchSourcedBy();
            if (!cancelled) setSourcedBy(data);
            break;
          }
          case "Themes": {
            const data = await fetchThemes();
            if (!cancelled) setThemes(data);
            break;
          }
          case "Special Filters": {
            const data = await fetchSpecialFilters();
            if (!cancelled) setSpecialFilters(data);
            break;
          }
          case "Configuration": {
            const [sv, cv] = await Promise.all([fetchStaticValues(), fetchConfigurations()]);
            if (!cancelled) {
              setStaticValues(sv.map(v => ({ ...v, configType: "investment-terms" as SiteConfigType })));
              setConfigurations(cv.map(v => ({ ...v, configType: "Configuration" as SiteConfigType })));
            }
            break;
          }
          case "Transaction Type": {
            const data = await fetchTransactionTypes();
            if (!cancelled) setTransactionTypes(data);
            break;
          }
          case "Investment Type": {
            const data = await fetchInvestmentTypeCategories();
            if (!cancelled) setInvestmentTypeCategories(data);
            break;
          }
          case "News Type": {
            const data = await fetchNewsTypes();
            if (!cancelled) setNewsTypes(data);
            break;
          }
          case "News Audience": {
            const data = await fetchNewsAudiences();
            if (!cancelled) setNewsAudiences(data);
            break;
          }
          case "Statistics": {
            const data = await fetchStatistics();
            if (!cancelled) setStatistics(data);
            break;
          }
          case "Meta Information": {
            const data = await fetchMetaInformation();
            if (!cancelled) setMetaInformation(data);
            break;
          }
          case "Contact Info": {
            const data = await fetchContactInfo();
            if (!cancelled) setContactInfo(data);
            break;
          }
          case "DAF Providers": {
            const data = await fetchDAFProviders();
            if (!cancelled) setDafProviders(data);
            break;
          }
        }
        if (!cancelled) loadedTabsRef.current.add(activeTab);
      } catch {
        if (!cancelled) setFetchError("Failed to load site configuration. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, retryToken]);

  // ─── Assign Popover (real API) ──────────────────────────────────────────────
  function AssignPopover({ itemId, itemName, type }: { itemId: number; itemName: string; type: SiteConfigType }) {
    const [open, setOpen] = useState(false);
    const [investments, setInvestments] = useState<ConfigItemInvestment[]>([]);
    const [loadingInv, setLoadingInv] = useState(false);
    const [togglingId, setTogglingId] = useState<number | null>(null);
    const [search, setSearch] = useState("");

    function handleOpenChange(isOpen: boolean) {
      setOpen(isOpen);
      if (isOpen) {
        setSearch("");
        setLoadingInv(true);
        fetchConfigItemInvestments(type, itemId)
          .then(setInvestments)
          .catch(() => setInvestments([]))
          .finally(() => setLoadingInv(false));
      }
    }

    async function handleToggle(inv: ConfigItemInvestment) {
      if (togglingId !== null) return;
      setTogglingId(inv.id);
      // Optimistic update
      setInvestments((prev) => prev.map((i) => (i.id === inv.id ? { ...i, isSelected: !i.isSelected } : i)));
      try {
        await toggleConfigItemInvestment(type, itemId, inv.id);
      } catch {
        // Revert on failure
        setInvestments((prev) => prev.map((i) => (i.id === inv.id ? { ...i, isSelected: inv.isSelected } : i)));
      } finally {
        setTogglingId(null);
      }
    }

    const filtered = search.trim() ? investments.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : investments;

    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button size="icon" variant="outline" className="h-8 w-8 rounded-l-none text-[#0ab39c] hover:text-[#0ab39c] hover:bg-[#0ab39c]/5" data-testid={`button-assign-${itemId}`}>
                <ListPlus className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Assign to Investments</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" side="bottom" className="w-[280px] p-0" data-testid={`popover-assign-${itemId}`}>
          <div className="px-4 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Assign to Investments</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{itemName}</p>
          </div>
          <div className="px-4 pb-2">
            <Input placeholder="Search investments..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs" data-testid={`input-assign-search-${itemId}`} />
          </div>
          <div className="max-h-[240px] overflow-y-auto border-t">
            {loadingInv ? (
              <p className="px-4 py-3 text-xs text-muted-foreground text-center">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground text-center">No investments found</p>
            ) : (
              filtered.map((inv) => (
                <label key={inv.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/30 cursor-pointer transition-colors" data-testid={`label-assign-${itemId}-${inv.id}`}>
                  <Checkbox checked={inv.isSelected} disabled={togglingId === inv.id} onCheckedChange={() => handleToggle(inv)} data-testid={`checkbox-assign-${itemId}-${inv.id}`} />
                  <span className="text-xs">{inv.name}</span>
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  function getAddLabel() {
    switch (activeTab) {
      case "Sourced By":
        return "Add Sourced By";
      case "Themes":
        return "Add Theme";
      case "Special Filters":
        return "Add Special Filter";
      case "Configuration":
        return "Add Configuration";
      case "Transaction Type":
        return "Add Transaction Type";
      case "Investment Type":
        return "Add Investment Type";
      case "News Type":
        return "Add News Type";
      case "News Audience":
        return "Add News Audience";
      case "Statistics":
        return "Add Statistic";
      case "Meta Information":
        return "Add Meta Information";
      case "Contact Info":
        return "Add Contact Info";
      case "DAF Providers":
        return "Add DAF Provider";
    }
  }

  function openAdd() {
    setEditingItem({
      id: null, field1: "", field2: "", field3: "", imagePreview: "",
      imageFileName: activeTab === "Contact Info" ? "emails" : "",
      configType: getApiType(activeTab)
    });
    setDialogOpen(true);
  }

  function openEdit(id: number | string, type?: SiteConfigType) {
    switch (activeTab) {
      case "Sourced By": {
        const item = sourcedBy.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.name, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "Themes": {
        const item = themes.find((i) => i.id === id);
        if (item)
          setEditingItem({
            id,
            field1: item.name,
            field2: item.description || "",
            field3: "",
            imagePreview: item.image || "",
            imageFileName: item.imageFileName || ""
          });
        break;
      }
      case "Special Filters": {
        const item = specialFilters.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.tag, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "Configuration": {
        const item = [...staticValues, ...configurations].find((i) => i.id === id && i.configType === type);
        if (item) setEditingItem({ id, field1: item.key, field2: item.value, field3: "", imagePreview: "", imageFileName: "", configType: item.configType });
        break;
      }
      case "Transaction Type": {
        const item = transactionTypes.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.name, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "Investment Type": {
        const item = investmentTypeCategories.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.name, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "News Type": {
        const item = newsTypes.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.name, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "News Audience": {
        const item = newsAudiences.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.name, field2: "", field3: "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "Statistics": {
        const item = statistics.find((i) => i.id === id);
        if (item) setEditingItem({ id, field1: item.key, field2: item.value, field3: item.type || "", imagePreview: "", imageFileName: "" });
        break;
      }
      case "Meta Information": {
        const item = metaInformation.find((i) => i.id === id);
        if (item)
          setEditingItem({
            id,
            field1: item.additionalDetails,
            field2: item.key,
            field3: item.value,
            imagePreview: item.image || "",
            imageFileName: item.imageName || ""
          });
        break;
      }
      case "Contact Info": {
        const item = contactInfo.find((i) => i.id === id);
        if (item)
          setEditingItem({
            id,
            field1: item.key,
            field2: item.value,
            field3: item.description || "",
            imagePreview: "",
            imageFileName: ""
          });
        break;
      }
      case "DAF Providers": {
        const item = dafProviders.find((i) => i.id === id);
        if (item)
          setEditingItem({
            id,
            field1: item.name,
            field2: item.url,
            field3: "",
            imagePreview: "",
            imageFileName: ""
          });
        break;
      }
    }
    setDialogOpen(true);
  }

  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const { id, field1, configType } = editingItem;
    if (isSaving) return;
    if (activeTab !== "Meta Information" && !field1.trim()) {
      if (activeTab === "DAF Providers") {
        toast({ title: "Cannot Save", description: "Provider Name is required.", variant: "destructive" });
      }
      return;
    }

    const isAutoDeleteConfig = activeTab === "Configuration" && field1.toLowerCase().startsWith("auto delete archived");
    const useRichText = (activeTab === "Configuration" && !isAutoDeleteConfig) || activeTab === "Statistics";
    const richTextValue = useRichText && editorRef.current ? editorRef.current.innerHTML : editingItem.field2;

    // Build the payload the API expects
    const type = configType || getApiType(activeTab);
    const payload: SiteConfigSavePayload = {
      type,
      value: field1.trim(),
      key: field1.trim() // always sent (same as value for all types)
    };
    if (id) payload.id = id;
    if (activeTab === "Configuration" || activeTab === "Statistics") {
      payload.value = richTextValue.trim();
      payload.key = field1.trim();
      if (activeTab === "Statistics") {
        payload.itemType = editingItem.field3.trim();
      }
    }
    if (activeTab === "Contact Info") {
      payload.key = field1.trim();
      payload.value = editingItem.field2.trim();
      payload.additionalDetails = editingItem.field3.trim();
      if (!id) {
        payload.itemType = editingItem.imageFileName || "emails";
      }
    }
    if (activeTab === "Meta Information") {
      payload.additionalDetails = field1.trim();
      payload.key = editingItem.field2.trim();
      payload.value = editingItem.field3.trim();
      payload.imageFileName = editingItem.imageFileName;
      payload.image = editingItem.imagePreview.startsWith("data:") ? editingItem.imagePreview : "";

      if (!payload.additionalDetails) {
        toast({ title: "Cannot Save", description: "Identifier is required.", variant: "destructive" });
        return;
      }
      if (!payload.key) {
        toast({ title: "Cannot Save", description: "Page Title is required.", variant: "destructive" });
        return;
      }
      if (!payload.value) {
        toast({ title: "Cannot Save", description: "Description is required.", variant: "destructive" });
        return;
      }
    }
    if (activeTab === "Themes") {
      payload.imageFileName = editingItem.imageFileName;
      payload.image = editingItem.imagePreview.startsWith("data:") ? editingItem.imagePreview : "";
      payload.description = editingItem.field2 || undefined;
    }
    if (activeTab === "DAF Providers") {
      const url = (editingItem.field2 ?? "").trim();
      if (!url) {
        toast({ title: "Cannot Save", description: "Provider URL is required.", variant: "destructive" });
        return;
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        toast({ title: "Cannot Save", description: "Provider URL must be a valid http or https URL.", variant: "destructive" });
        return;
      }
      payload.link = url;
    }

    setIsSaving(true);
    try {
      await saveSiteConfigItem(payload);

      // Re-fetch only the modified section to get real server IDs
      switch (activeTab) {
        case "Sourced By":
          setSourcedBy(await fetchSourcedBy());
          break;
        case "Themes":
          setThemes(await fetchThemes());
          break;
        case "Special Filters":
          setSpecialFilters(await fetchSpecialFilters());
          break;
        case "Configuration": {
          const [sv, cv] = await Promise.all([fetchStaticValues(), fetchConfigurations()]);
          setStaticValues(sv.map(v => ({ ...v, configType: "investment-terms" as SiteConfigType })));
          setConfigurations(cv.map(v => ({ ...v, configType: "Configuration" as SiteConfigType })));
          break;
        }
        case "Transaction Type":
          setTransactionTypes(await fetchTransactionTypes());
          break;
        case "Investment Type":
          setInvestmentTypeCategories(await fetchInvestmentTypeCategories());
          break;
        case "News Type":
          setNewsTypes(await fetchNewsTypes());
          break;
        case "News Audience":
          setNewsAudiences(await fetchNewsAudiences());
          break;
        case "Statistics":
          setStatistics(await fetchStatistics());
          break;
        case "Meta Information":
          setMetaInformation(await fetchMetaInformation());
          break;
        case "Contact Info":
          setContactInfo(await fetchContactInfo());
          break;
        case "DAF Providers":
          setDafProviders(await fetchDAFProviders());
          break;
      }
      toast({
        title: `${activeTab} saved successfully`,
      });
      setDialogOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save item. Please try again.";
      toast({
        title: "Cannot Save",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  }

  function openDelete(id: number | string, name: string, configType?: SiteConfigType) {
    setDeleteTarget({ id, name, configType: configType || getApiType(activeTab) });
    setDeleteDialogOpen(true);
  }

  const [isDeleting, setIsDeleting] = useState(false);

  /** Map tab label → API type string */
  function getApiType(tab: TabKey): SiteConfigType {
    switch (tab) {
      case "Sourced By":
        return "sourcedby";
      case "Themes":
        return "themes";
      case "Special Filters":
        return "special-filters";
      case "Configuration":
        return "Configuration";
      case "Transaction Type":
        return "transaction-type";
      case "Investment Type":
        return "investment-type-category";
      case "News Type":
        return "news-type";
      case "News Audience":
        return "news-audience";
      case "Statistics":
        return "statistics";
      case "Meta Information":
        return "meta-information";
      case "Contact Info":
        return "contact-info";
      case "DAF Providers":
        return "daf-providers";
    }
  }

  async function handleDelete() {
    if (!deleteTarget || isDeleting) return;
    const { id, configType: deleteConfigType } = deleteTarget;
    const type = deleteConfigType || getApiType(activeTab);
    setIsDeleting(true);
    try {
      await deleteSiteConfigItem(type, id);
      switch (activeTab) {
        case "Sourced By":
          setSourcedBy((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Themes":
          setThemes((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Special Filters":
          setSpecialFilters((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Configuration": {
          const [sv, cv] = await Promise.all([fetchStaticValues(), fetchConfigurations()]);
          setStaticValues(sv.map(v => ({ ...v, configType: "investment-terms" as SiteConfigType })));
          setConfigurations(cv.map(v => ({ ...v, configType: "Configuration" as SiteConfigType })));
          break;
        }
        case "Transaction Type":
          setTransactionTypes((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Investment Type":
          setInvestmentTypeCategories((prev) => prev.filter((i) => i.id !== id));
          break;
        case "News Type":
          setNewsTypes((prev) => prev.filter((i) => i.id !== id));
          break;
        case "News Audience":
          setNewsAudiences((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Statistics":
          setStatistics((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Meta Information":
          setMetaInformation((prev) => prev.filter((i) => i.id !== id));
          break;
        case "Contact Info":
          setContactInfo((prev) => prev.filter((i) => i.id !== id));
          break;
        case "DAF Providers":
          setDafProviders((prev) => prev.filter((i) => i.id !== id));
          break;
      }
      toast({
        title: `${activeTab} deleted successfully`,
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete item. Please try again.";
      toast({
        title: "Cannot Delete",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleToggleDafActive(item: DAFProviderItem) {
    if (togglingDafId !== null) return;
    setTogglingDafId(item.id);
    setDafProviders((prev) => prev.map((p) => (p.id === item.id ? { ...p, isActive: !p.isActive } : p)));
    try {
      await toggleDAFProviderActive(item.id);
      toast({
        title: !item.isActive ? "DAF provider activated" : "DAF provider deactivated",
      });
    } catch (err) {
      setDafProviders((prev) => prev.map((p) => (p.id === item.id ? { ...p, isActive: item.isActive } : p)));
      const message = err instanceof Error ? err.message : "Failed to update status.";
      toast({ title: "Cannot Update", description: message, variant: "destructive" });
    } finally {
      setTogglingDafId(null);
    }
  }

  function getDialogTitle() {
    const action = editingItem.id ? "Edit" : "Add";
    switch (activeTab) {
      case "Sourced By":
        return `${action} Sourced By`;
      case "Themes":
        return `${action} Theme`;
      case "Special Filters":
        return `${action} Special Filter`;
      case "Configuration":
        return `${action} Configuration`;
      case "Transaction Type":
        return `${action} Transaction Type`;
      case "Investment Type":
        return `${action} Investment Type`;
      case "News Type":
        return `${action} News Type`;
      case "News Audience":
        return `${action} News Audience`;
      case "Statistics":
        return `${action} Statistic`;
      case "Meta Information":
        return `${action} Meta Information`;
      case "Contact Info":
        return "Edit Contact Info";
      case "DAF Providers":
        return `${action} DAF Provider`;
    }
  }

  function getField1Label() {
    switch (activeTab) {
      case "Special Filters":
        return "Tag";
      case "Configuration":
      case "Contact Info":
        return "Key";
      case "Meta Information":
        return "Identifier";
      case "DAF Providers":
        return "Provider Name";
      default:
        return "Name";
    }
  }

  const showThirdAction = activeTab === "Sourced By" || activeTab === "Themes" || activeTab === "Special Filters";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Site Configuration
        </h1>

        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map((tab) => (
            <Button
              key={tab}
              variant={activeTab === tab ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (tab === activeTab && !loadedTabsRef.current.has(tab) && !loading) {
                  setRetryToken((n) => n + 1);
                }
                setActiveTab(tab);
                localStorage.setItem(STORAGE_KEY, tab);
              }}
              className={activeTab === tab ? "bg-[#405189] text-white" : ""}
              data-testid={`tab-${tab.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {tab}
            </Button>
          ))}
        </div>

        {/* Error banner (scoped to active tab) */}
        {!loading && fetchError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" data-testid="text-fetch-error">
            {fetchError}
          </div>
        )}

        {/* Loading skeleton (scoped to active tab content) */}
        {loading && (
          <div className="space-y-3 animate-pulse" data-testid="skeleton-loading">
            <div className="rounded-md border">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3">
                  <div className="h-4 flex-1 rounded bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            {activeTab === "Contact Info" ? (
              <div className="space-y-4" data-testid="contact-info-sections">
                <div className="flex justify-end">
                  <Button className="bg-[#405189] text-white" onClick={openAdd} data-testid="button-add-contact-info">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Contact Info
                  </Button>
                </div>
                {CONTACT_INFO_SECTIONS.map((section) => {
                  const items = contactInfo.filter((i) => i.type === section.key);
                  return (
                    <Card key={section.key}>
                      <CardContent className="p-0">
                        <div className="px-4 py-3 border-b bg-muted/50">
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider" data-testid={`section-heading-${section.key}`}>
                            {section.label}
                          </h3>
                        </div>
                        <table className="w-full" data-testid={`table-contact-${section.key}`}>
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[200px]">Key</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[280px]">Value</th>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                              <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[100px]">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                  No items found
                                </td>
                              </tr>
                            ) : (
                              items.map((item) => (
                                <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-contact-${item.id}`}>
                                  <td className="px-4 py-3">
                                    <span className="text-sm font-medium" data-testid={`text-contact-key-${item.id}`}>{item.key}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-sm" data-testid={`text-contact-value-${item.id}`}>{item.value}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-sm text-muted-foreground" data-testid={`text-contact-desc-${item.id}`}>{item.description || "—"}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end">
                                      <div className="inline-flex rounded-md shadow-sm">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="outline"
                                              className={cn(
                                                "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                                hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                              )}
                                              onClick={() => openEdit(item.id)}
                                              data-testid={`button-edit-contact-${item.id}`}
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Edit Value</TooltipContent>
                                        </Tooltip>
                                        {hasActionPermission("site configuration", "delete") && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="icon"
                                                variant="outline"
                                                className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                                onClick={() => openDelete(item.id, item.key)}
                                                data-testid={`button-delete-contact-${item.id}`}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Delete Item</TooltipContent>
                                          </Tooltip>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
            <Card>
              <CardContent className="p-0">
                <div className="flex justify-end p-4">
                  <Button className="bg-[#405189] text-white" onClick={openAdd} data-testid="button-add-item">
                    <Plus className="h-4 w-4 mr-1.5" />
                    {getAddLabel()}
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  {activeTab === "Configuration" || activeTab === "Statistics" || activeTab === "Meta Information" ? (
                    <table className="w-full" data-testid="table-config">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {activeTab === "Meta Information" && <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[100px]">Image</th>}
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[280px]">{activeTab === "Meta Information" ? "Identifier" : "Key"}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[280px]">{activeTab === "Meta Information" ? "Title" : "Value"}</th>
                          {(activeTab === "Statistics" || activeTab === "Meta Information") && <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[150px]">{activeTab === "Meta Information" ? "Description" : "Type"}</th>}
                          <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[100px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeTab === "Configuration" &&
                          [...staticValues, ...configurations]
                            .sort((a, b) => {
                              const aIsAutoDelete = a.key.toLowerCase().startsWith("auto delete archived");
                              const bIsAutoDelete = b.key.toLowerCase().startsWith("auto delete archived");
                              if (aIsAutoDelete && !bIsAutoDelete) return -1;
                              if (!aIsAutoDelete && bIsAutoDelete) return 1;
                              return 0;
                            })
                            .map((item) => {
                              const isAutoDelete = item.key.toLowerCase().startsWith("auto delete archived");
                              return (
                            <tr key={`${item.configType}-${item.id}`} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3 align-top">
                                <span className="text-sm font-medium" data-testid={`text-key-${item.id}`}>
                                  {item.key}
                                </span>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div
                                  className="text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
                                  data-testid={`text-value-${item.id}`}
                                  dangerouslySetInnerHTML={{ __html: item.value }}
                                />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            !isAutoDelete && hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id, item.configType)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {!isAutoDelete && hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.key, item.configType)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                              );
                            })}
                        {activeTab === "Meta Information" &&
                          metaInformation.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <img src={item.image || catacapDefaultImageLogo} alt={item.key} className="h-10 w-10 rounded-md object-cover" />
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm font-medium" data-testid={`text-identifier-${item.id}`}>
                                  {item.additionalDetails}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-muted-foreground" data-testid={`text-title-${item.id}`}>
                                  {item.key}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                <div className="max-w-[300px] truncate">{item.value}</div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.additionalDetails)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Statistics" &&
                          statistics.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm font-medium" data-testid={`text-key-${item.id}`}>
                                  {item.key}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-muted-foreground" data-testid={`text-value-${item.id}`}>
                                  {item.value}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{item.type || <span className="italic opacity-50">—</span>}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.key)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Configuration" && staticValues.length === 0 && configurations.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No items found
                            </td>
                          </tr>
                        )}
                        {activeTab === "Statistics" && statistics.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No items found
                            </td>
                          </tr>
                        )}
                        {activeTab === "Meta Information" && metaInformation.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No items found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full" data-testid="table-config">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {activeTab === "Themes" ? (
                            <>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[140px]">Actions</th>
                            </>
                          ) : activeTab === "DAF Providers" ? (
                            <>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">URL</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[120px]">Status</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[140px]">Actions</th>
                            </>
                          ) : (
                            <>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{activeTab === "Special Filters" ? "Tag" : "Name"}</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[140px]">Actions</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {activeTab === "Sourced By" &&
                          sourcedBy.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-none border-r-0 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                    <AssignPopover itemId={item.id} itemName={item.name} type="sourcedby" />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Themes" &&
                          themes.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <img src={item.image || catacapDefaultImageLogo} alt={item.name} className="h-10 w-10 rounded-md object-cover" />
                                  <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                    {item.name}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-muted-foreground" data-testid={`text-description-${item.id}`}>
                                  {item.description || <span className="italic text-muted-foreground/50">—</span>}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-none border-r-0 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                    <AssignPopover itemId={item.id} itemName={item.name} type="themes" />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Special Filters" &&
                          specialFilters.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-tag-${item.id}`}>
                                  {item.tag}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-none border-r-0 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.tag)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                    <AssignPopover itemId={item.id} itemName={item.tag} type="special-filters" />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Investment Type" &&
                          investmentTypeCategories.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "Transaction Type" &&
                          transactionTypes.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "News Type" &&
                          newsTypes.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "News Audience" &&
                          newsAudiences.map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <div className="inline-flex rounded-md shadow-sm">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className={cn(
                                            "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                            hasActionPermission("site configuration", "delete") ? "rounded-r-none border-r-0" : ""
                                          )}
                                          onClick={() => openEdit(item.id)}
                                          data-testid={`button-edit-${item.id}`}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Edit Item</TooltipContent>
                                    </Tooltip>

                                    {hasActionPermission("site configuration", "delete") && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="outline"
                                            className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                            onClick={() => openDelete(item.id, item.name)}
                                            data-testid={`button-delete-${item.id}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Item</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {activeTab === "DAF Providers" &&
                          [...dafProviders].sort((a, b) => a.id - b.id).map((item) => (
                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-item-${item.id}`}>
                              <td className="px-4 py-3">
                                <span className="text-sm" data-testid={`text-name-${item.id}`}>
                                  {item.name}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-[#405189] hover:underline break-all"
                                  data-testid={`text-url-${item.id}`}
                                >
                                  {item.url}
                                </a>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={item.isActive}
                                    disabled={togglingDafId === item.id}
                                    onCheckedChange={() => handleToggleDafActive(item)}
                                    data-testid={`switch-active-${item.id}`}
                                  />
                                  <span className="text-xs text-muted-foreground" data-testid={`text-active-${item.id}`}>
                                    {item.isActive ? "Active" : "Inactive"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                        onClick={() => openEdit(item.id)}
                                        data-testid={`button-edit-${item.id}`}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit Item</TooltipContent>
                                  </Tooltip>
                                </div>
                              </td>
                            </tr>
                          ))}
                        {((activeTab === "Sourced By" && sourcedBy.length === 0) ||
                          (activeTab === "Themes" && themes.length === 0) ||
                          (activeTab === "Special Filters" && specialFilters.length === 0) ||
                          (activeTab === "Transaction Type" && transactionTypes.length === 0) ||
                          (activeTab === "Investment Type" && investmentTypeCategories.length === 0) ||
                          (activeTab === "News Type" && newsTypes.length === 0) ||
                          (activeTab === "News Audience" && newsAudiences.length === 0) ||
                          (activeTab === "DAF Providers" && dafProviders.length === 0)) && (
                            <tr>
                              <td colSpan={activeTab === "Themes" ? 3 : activeTab === "DAF Providers" ? 4 : 2} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                No items found
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  )}
                </div>
              </CardContent>
            </Card>
            )}
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={activeTab === "Themes" ? "sm:max-w-[480px]" : "sm:max-w-[680px]"} data-testid="dialog-add-edit">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">{getDialogTitle()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {getField1Label()}
                {activeTab === "DAF Providers" && <span className="text-destructive"> *</span>}
              </label>
              <Input
                value={editingItem.field1}
                onChange={(e) => setEditingItem((prev) => ({ ...prev, field1: e.target.value }))}
                placeholder={`Enter ${getField1Label().toLowerCase()}`}
                disabled={(!!editingItem.id && activeTab === "Configuration" && editingItem.field1.toLowerCase().startsWith("auto delete archived")) || (activeTab === "Contact Info" && !!editingItem.id)}
                data-testid="input-field1"
              />
            </div>
            {(activeTab === "Themes" || activeTab === "Meta Information") && (
              <div className="space-y-2">
                {editingItem.imagePreview || editingItem.imageFileName ? (
                  <div className="flex items-center gap-4">
                    <img
                      src={editingItem.imagePreview || getUrlBlobContainerImage(editingItem.imageFileName, true)}
                      alt="Preview"
                      className="h-24 w-24 rounded-md object-cover border"
                      data-testid="img-theme-preview"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[#f06548] border-[#f06548] hover:bg-[#f06548]/5"
                      onClick={() => setEditingItem((prev) => ({ ...prev, imagePreview: "", imageFileName: "" }))}
                      data-testid="button-remove-image"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove Image
                    </Button>
                  </div>
                ) : (
                  <label
                    className="inline-flex items-center gap-2 cursor-pointer border rounded-md px-4 py-2 text-sm text-[#405189] border-[#405189]"
                    data-testid="label-upload-image"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Upload Image *</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setEditingItem((prev) => ({
                              ...prev,
                              imagePreview: reader.result as string,
                              imageFileName: file.name,
                            }));
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      data-testid="input-upload-image"
                    />
                  </label>
                )}
              </div>
            )}
            {activeTab === "Themes" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  value={editingItem.field2}
                  onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))}
                  placeholder="Enter theme description (optional)"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  data-testid="input-theme-description"
                />
              </div>
            )}
            {activeTab === "Configuration" && editingItem.field1.toLowerCase().startsWith("auto delete archived") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Value</label>
                <Input value={editingItem.field2} onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))} placeholder="Enter value" data-testid="input-field2" />
              </div>
            )}
            {activeTab === "Configuration" && !editingItem.field1.toLowerCase().startsWith("auto delete archived") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Value</label>
                <div className="border rounded-md overflow-hidden">
                  <div className="flex items-center gap-0.5 p-1.5 border-b bg-muted/50">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("bold")} data-testid="button-format-bold">
                      <Bold className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("italic")} data-testid="button-format-italic">
                      <Italic className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("underline")} data-testid="button-format-underline">
                      <Underline className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        const url = prompt("Enter URL:");
                        if (url) document.execCommand("createLink", false, url);
                      }}
                      data-testid="button-format-link"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("insertUnorderedList")} data-testid="button-format-ul">
                      <List className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("insertOrderedList")} data-testid="button-format-ol">
                      <ListOrdered className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => document.execCommand("strikeThrough")} data-testid="button-format-strikethrough">
                      <Strikethrough className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    className="min-h-[140px] p-3 text-sm focus:outline-none prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: editingItem.field2 }}
                    onBlur={(e) => setEditingItem((prev) => ({ ...prev, field2: e.currentTarget.innerHTML }))}
                    data-testid="input-richtext-value"
                    data-placeholder="Enter value"
                  />
                </div>
              </div>
            )}
            {activeTab === "Contact Info" && !editingItem.id && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Group</label>
                <select
                  value={editingItem.imageFileName}
                  onChange={(e) => setEditingItem((prev) => ({ ...prev, imageFileName: e.target.value }))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="select-contact-group"
                >
                  {CONTACT_INFO_SECTIONS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            {activeTab === "Contact Info" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Value</label>
                  <Input
                    value={editingItem.field2}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))}
                    placeholder="Enter value"
                    data-testid="input-contact-value"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={editingItem.field3}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, field3: e.target.value }))}
                    placeholder="What is this value used for?"
                    data-testid="input-contact-description"
                  />
                </div>
              </div>
            )}
            {activeTab === "Statistics" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Input value={editingItem.field3} onChange={(e) => setEditingItem((prev) => ({ ...prev, field3: e.target.value }))} placeholder="e.g. Percentage" data-testid="input-field3" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Value</label>
                  <Input value={editingItem.field2} onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))} placeholder="e.g. 59" data-testid="input-field2" />
                </div>
              </div>
            )}
            {activeTab === "DAF Providers" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Provider URL
                  <span className="text-destructive"> *</span>
                </label>
                <Input
                  value={editingItem.field2}
                  onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))}
                  placeholder="https://example.com"
                  data-testid="input-daf-provider-url"
                />
              </div>
            )}
            {activeTab === "Meta Information" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Page Title</label>
                  <Input value={editingItem.field2} onChange={(e) => setEditingItem((prev) => ({ ...prev, field2: e.target.value }))} placeholder="Enter page title" data-testid="input-field2" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    value={editingItem.field3}
                    onChange={(e) => setEditingItem((prev) => ({ ...prev, field3: e.target.value }))}
                    placeholder="Enter description"
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                    data-testid="input-field3"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving} data-testid="button-dialog-cancel">
              Cancel
            </Button>
            <Button className="bg-[#405189] text-white" onClick={handleSave} disabled={isSaving} data-testid="button-dialog-save">
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]" data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-sm py-2" data-testid="text-delete-message">
            Are you sure you want to delete "<strong>{deleteTarget?.name}</strong>"?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting} data-testid="button-delete-cancel">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} data-testid="button-delete-confirm">
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
