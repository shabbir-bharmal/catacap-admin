import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import dayjs from "dayjs";
import { formatDate, formatDateISO } from "@/helpers/format";
import { useParams, useLocation, useSearch } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { RichTextEditor } from "../components/RichTextEditor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import BannerCropper from "@/components/BannerCropper";
import { MultiSelectPopover } from "@/components/MultiSelectPopover";
import { UserEmailCombobox } from "@/components/UserEmailCombobox";
import { CalendarIcon, ArrowLeft, Download, ChevronDown, Copy, QrCode, Mail, User, Briefcase, ImageIcon, Settings, ArrowRight, CheckCircle2, Check, Pencil, Trash2, HelpCircle, FileText, Clock, X as XIcon, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QRCodeCanvas } from "qrcode.react";

const STEPS = [
  { id: 0, label: "About You", icon: User },
  { id: 1, label: "About the Investment", icon: Briefcase },
  { id: 2, label: "Media", icon: ImageIcon },
  { id: 3, label: "Admin Settings", icon: Settings },
  { id: 4, label: "Admin Details", icon: Settings },
  { id: 5, label: "Updates", icon: Mail },
];

import { fetchCountries, fetchInvestmentById, fetchInvestmentData, updateInvestment, exportInvestmentRecommendations, fetchAllInvestmentNameList, sendInvestmentQrCodeEmail, fetchInvestmentNotes, exportInvestmentNotesApi, downloadInvestmentDocument, fetchCampaignUpdates, createCampaignUpdate, updateCampaignUpdate, deleteCampaignUpdate, sendCampaignUpdateEmail, getCampaignUpdateEmailPreview, fetchCampaignUpdateEmailLogs, type CampaignUpdateItem, type CampaignUpdateAttachmentItem, type CampaignUpdateAttachmentInput, type CampaignUpdateEmailLogItem } from "@/api/investment/investmentApi";
import { fetchActiveEmailTemplateByCategory, fetchEmailTemplatePreview } from "@/api/email-template/emailTemplateApi";
import { fetchAllGroups, GroupUpdatePayload } from "@/api/group/groupApi";
import { fetchAllAdminUsers, AdminUserItem } from "@/api/user/userApi";
import { fetchStaticValues, StaticValueItem } from "@/api/site-configuration/siteConfigurationApi";
import { defaultImage, getUrlBlobContainerImage } from "@/lib/image-utils";

const CLOSED_NOT_INVESTED_STAGE = "4";


const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming", "District of Columbia",
];

const INVESTMENT_TYPE_CATEGORY_OPTIONS = [
  { value: "funds", label: "Funds" },
  { value: "direct_investments", label: "Direct Investments" },
];

const DEBT_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "bi-annually", label: "Bi-annually" },
  { value: "annually", label: "Annually" },
  { value: "other", label: "Other" },
];

const STAGE_OPTIONS = [
  { value: "1", label: "Private" },
  { value: "2", label: "Public" },
  { value: "3", label: "Closed - Invested" },
  { value: "4", label: "Closed - Not Invested" },
  { value: "5", label: "New" },
  { value: "6", label: "Compliance Review" },
  { value: "7", label: "Completed - Ongoing" },
  { value: "8", label: "Vetting" },
  { value: "9", label: "Completed - Ongoing/Private" },
];

const inputHeaderLabelStyle = {
  fontWeight: "bold",
  fontSize: "14px",
  color: "#343a40",
  marginBottom: "8px",
};

const inputLabelStyle = {
  fontSize: "12px",
  color: "#878a99",
  marginTop: "8px",
};

const uploadTextStyle = {
  fontSize: "14px",
  color: "#878a99",
};

const errorTextStyle = {
  fontSize: "12px",
  color: "#f06548",
  marginTop: "4px",
};

interface FormData {
  id: number | null;
  contactInfoFullName: string;
  email: string;
  investmentInfoEmail: string;
  contactInfoPhoneNumber: string;
  impactAssetsFundingStatus: string;
  hasCorporateBankAccount: string;
  hasPersonalFinancialBenefit: string;
  personalFinancialBenefitDescription: string;
  hasRegulatoryIssues: string;
  regulatoryIssuesDescription: string;
  isInGoodLegalStanding: string;
  country: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  otherCountryAddress: string;
  networkDescription: string;
  referredToCataCap: string;
  investmentRole: string;
  name: string;
  website: string;
  target: string;
  minimumInvestment: string;
  expectedTotal: string;
  missionVision: string;
  isEvergreen: boolean;
  fundraisingCloseDate: string;
  personalizedThankYou: string;
  themeIds: number[];
  sdgIds: number[];
  investmentTypeIds: number[];
  description: string;
  terms: string;
  featuredInvestment: boolean;
  approvedBy: string[];
  property: string;
  stage: string;
  privateGroupID: string;
  ownerGroupId: string;
  autoEnrollInvestors: boolean;
  associatedFundId: number | null;
  isActive: boolean;
  isPartOfFund: boolean;
  investmentTagValues: string[];
  addedTotalAdminRaised: string;
  investmentTypeCategory: string;
  equityValuation: string;
  equitySecurityType: string;
  fundTerm: string;
  equityTargetReturn: string;
  debtPaymentFrequency: string;
  debtMaturityDate: string;
  debtInterestRate: string;
  metaTitle: string;
  metaDescription: string;
  investmentNotificationRecipients: { name: string; email: string }[];
}

const defaultFormData: FormData = {
  id: null,
  contactInfoFullName: "",
  email: "",
  investmentInfoEmail: "",
  contactInfoPhoneNumber: "",
  impactAssetsFundingStatus: "No",
  hasCorporateBankAccount: "",
  hasPersonalFinancialBenefit: "",
  personalFinancialBenefitDescription: "",
  hasRegulatoryIssues: "",
  regulatoryIssuesDescription: "",
  isInGoodLegalStanding: "",
  country: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  zipCode: "",
  otherCountryAddress: "",
  networkDescription: "",
  referredToCataCap: "",
  investmentRole: "Company/Fund Executive",
  name: "",
  website: "",
  target: "",
  minimumInvestment: "",
  expectedTotal: "",
  missionVision: "",
  isEvergreen: false,
  fundraisingCloseDate: "",
  personalizedThankYou: "",
  themeIds: [],
  sdgIds: [],
  investmentTypeIds: [],
  description: "",
  terms: "",
  featuredInvestment: false,
  approvedBy: [],
  property: "",
  stage: "",
  privateGroupID: "",
  ownerGroupId: "",
  autoEnrollInvestors: false,
  associatedFundId: null,
  isActive: true,
  isPartOfFund: false,
  investmentTagValues: [],
  addedTotalAdminRaised: "",
  investmentTypeCategory: "",
  equityValuation: "",
  equitySecurityType: "",
  fundTerm: "",
  equityTargetReturn: "",
  debtPaymentFrequency: "",
  debtMaturityDate: "",
  debtInterestRate: "",
  metaTitle: "",
  metaDescription: "",
  investmentNotificationRecipients: [{ name: "", email: "" }],
};

interface ThemeItem { id: number; name: string; }
interface SdgItem { id: number; name: string; }
interface InvestmentTypeItem { id: number; name: string; }
interface InvestmentTagItem { id: number; tag: string; }
interface CountryItem { id?: number; name: string; }
interface ApprovedByItem { id: number; name: string; }
interface InvestmentNote { date: string; userName: string; note: string; oldStatus: string | null; newStatus: string | null; }

interface ThankYouAttachment {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  publicUrl: string | null;
  filePath?: string;
  sortOrder?: number | null;
}

interface PendingThankYouAttachment {
  localId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  dataBase64: string;
}

interface EmailPreviewTemplateOption {
  category: number;
  templateId: number;
  name: string;
  label: string;
}

const THANK_YOU_PER_FILE_MAX_BYTES = 10 * 1024 * 1024;
const THANK_YOU_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
const THANK_YOU_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const THANK_YOU_ALLOWED_EXT_REGEX = /\.(pdf|doc|docx|png|jpe?g|webp)$/i;
const THANK_YOU_ACCEPT_ATTR =
  ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp";

const EMAIL_PREVIEW_CATEGORIES: { category: number; label: string }[] = [
  { category: 8, label: "Donation Confirmation" },
];

const DONATION_CONFIRMATION_CATEGORY = 8;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function parseIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
}

function isValidImage(file: File): boolean {
  return /\.(png|jpg|jpeg|gif)$/i.test(file.name);
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

const compressImage = (file: File, imageType: string) => {
  return new Promise<File>((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const MAX_WIDTH = 1920;
      const MAX_HEIGHT = 1920;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;

      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
      }

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: file.type }));
          }
          URL.revokeObjectURL(img.src);
        },
        imageType,
        0.92
      );
    };
  });
};

function TagSelectPopover({
  options,
  selected,
  onToggle,
  testId,
}: {
  options: InvestmentTagItem[];
  selected: string[];
  onToggle: (tag: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState("");

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !selected.includes(trimmed)) {
      onToggle(trimmed);
    }
    setNewTag("");
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid={testId}
          >
            <span className="text-muted-foreground">Select or create tags...</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <div className="flex items-center gap-1.5 mb-2">
            <Input
              placeholder="Type new tag…"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
              className="h-8 text-sm"
              data-testid="input-new-tag"
            />
            <Button type="button" size="sm" className="h-8 px-3 shrink-0 bg-[#405189] hover:bg-[#364574] text-white" onClick={handleAddTag} disabled={!newTag.trim()}>
              Add
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {options.map((opt) => (
              <div
                key={opt.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                onClick={() => onToggle(opt.tag)}
              >
                <Checkbox
                  checked={selected.includes(opt.tag)}
                  onCheckedChange={() => onToggle(opt.tag)}
                  className="pointer-events-none"
                />
                <span className="text-sm">{opt.tag}</span>
              </div>
            ))}
            {options.length === 0 && <p className="text-sm text-muted-foreground px-2 py-1">No tags available</p>}
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded bg-[#405189]/10 text-[#405189] px-2.5 py-1 text-xs font-medium"
            >
              {tag}
              <button
                type="button"
                className="ml-0.5 hover:text-[#f06548] transition-colors"
                onClick={() => onToggle(tag)}
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminInvestmentEdit() {
  const params = useParams<{ idOrSlug: string }>();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const queryId = searchParams.get("id");
  const { toast } = useToast();
  const { token } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [investmentName, setInvestmentName] = useState("");
  const [resolvedNumericId, setResolvedNumericId] = useState<number | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [investmentOwnerValid, setInvestmentOwnerValid] = useState(true);
  const [propertyError, setPropertyError] = useState("");
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [sdgs, setSdgs] = useState<SdgItem[]>([]);
  const [sdgOptions, setSdgOptions] = useState<any[]>([]);
  const [investmentTypes, setInvestmentTypes] = useState<InvestmentTypeItem[]>([]);
  const [allTagOptions, setAllTagOptions] = useState<InvestmentTagItem[]>([]);
  const [investmentDataFailed, setInvestmentDataFailed] = useState(false);
  const [countries, setCountries] = useState<CountryItem[]>([]);
  const [groups, setGroups] = useState<GroupUpdatePayload[]>([]);
  const [approvedByOptions, setApprovedByOptions] = useState<ApprovedByItem[]>([]);
  const [investmentOptions, setInvestmentOptions] = useState<any[]>([]);
  const [investmentNotes, setInvestmentNotes] = useState<InvestmentNote[]>([]);
  const [staticTerms, setStaticTerms] = useState<StaticValueItem[]>([]);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [smallerFile, setSmallerFile] = useState<File | null>(null);
  const [pitchDeckFile, setPitchDeckFile] = useState<File | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const [logo, setLogo] = useState<string | undefined>();
  const [image, setImage] = useState<string | undefined>();
  const [tileImage, setTileImage] = useState<string | undefined>();
  const [pdf, setPdf] = useState<string | undefined>();

  const [logoFileName, setLogoFileName] = useState("");
  const [imageFileName, setImageFileName] = useState("");
  const [tileImageFileName, setTileImageFileName] = useState("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [originalPdfFileName, setOriginalPdfFileName] = useState<string | undefined>();

  const logoRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const tileImageRef = useRef<HTMLDivElement>(null);
  const pitchDeckRef = useRef<HTMLDivElement>(null);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string | null>(null);
  const [cropperTarget, setCropperTarget] = useState<"profile" | "tile" | null>(null);
  const [cropperAspect, setCropperAspect] = useState(763 / 400);
  const [cropProfileEnabled, setCropProfileEnabled] = useState(true);
  const [cropTileEnabled, setCropTileEnabled] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [fundTermOpen, setFundTermOpen] = useState(false);
  const [debtMaturityOpen, setDebtMaturityOpen] = useState(false);
  const [savedTagValues, setSavedTagValues] = useState<string[]>([]);
  const [savedApprovedBy, setSavedApprovedBy] = useState<string[]>([]);
  const [openQR, setOpenQR] = useState<string | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savedStage, setSavedStage] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [campaignUpdates, setCampaignUpdates] = useState<CampaignUpdateItem[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesSubmitting, setUpdatesSubmitting] = useState(false);
  const [sendingEmailUpdateId, setSendingEmailUpdateId] = useState<number | null>(null);
  const [deletingUpdateId, setDeletingUpdateId] = useState<number | null>(null);
  const [emailUpdateTarget, setEmailUpdateTarget] = useState<CampaignUpdateItem | null>(null);
  const [emailPreview, setEmailPreview] = useState<{
    subject: string;
    bodyHtml: string;
    from: string;
    cc: string[];
    recipientCount: number;
  } | null>(null);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [deleteUpdateTarget, setDeleteUpdateTarget] = useState<CampaignUpdateItem | null>(null);
  const [updateFormOpen, setUpdateFormOpen] = useState(false);
  const [editingUpdateId, setEditingUpdateId] = useState<number | null>(null);
  // Each form attachment is either an existing one (kept by id) or a new
  // pending upload (data URL + filename + mime). The order in the list is the
  // order shown in the dialog and persisted to the server.
  type UpdateFormAttachment =
    | {
        kind: "existing";
        id: number;
        fileName: string;
        fileUrl: string | null;
        previewUrl: string | null;
        mimeType: string | null;
        sizeBytes: number | null;
      }
    | {
        kind: "new";
        tempId: string;
        data: string;
        fileName: string;
        previewUrl: string | null;
        mimeType: string;
        sizeBytes: number;
      };
  // Three free-form (label, value) slots rendered in the New / Edit
  // Update modal under "Impact Highlights". The slot count is fixed so
  // the form layout stays stable; persistence treats all-blank rows as
  // "no highlights" (NULL on the server).
  const IMPACT_HIGHLIGHTS_SLOTS = 3;
  const emptyImpactHighlights = (): { label: string; value: string }[] =>
    Array.from({ length: IMPACT_HIGHLIGHTS_SLOTS }, () => ({ label: "", value: "" }));

  const [updateForm, setUpdateForm] = useState<{
    subject: string;
    description: string;
    shortDescription: string;
    startDate: string;
    endDate: string;
    attachments: UpdateFormAttachment[];
    impactHighlights: { label: string; value: string }[];
  }>({
    subject: "",
    description: "",
    shortDescription: "",
    startDate: "",
    endDate: "",
    attachments: [],
    impactHighlights: emptyImpactHighlights(),
  });
  const [emailLogsTarget, setEmailLogsTarget] = useState<CampaignUpdateItem | null>(null);
  const [emailLogs, setEmailLogs] = useState<CampaignUpdateEmailLogItem[]>([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [updateFormErrors, setUpdateFormErrors] = useState<Record<string, string>>({});
  const [updateStartOpen, setUpdateStartOpen] = useState(false);
  const [updateEndOpen, setUpdateEndOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [taggedUserNames, setTaggedUserNames] = useState<string[]>([]);
  const [taggedUserEmails, setTaggedUserEmails] = useState<string[]>([]);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [thankYouExistingAttachments, setThankYouExistingAttachments] = useState<ThankYouAttachment[]>([]);
  const [thankYouRemovedIds, setThankYouRemovedIds] = useState<number[]>([]);
  const [thankYouPendingFiles, setThankYouPendingFiles] = useState<PendingThankYouAttachment[]>([]);
  const [thankYouAttachmentError, setThankYouAttachmentError] = useState<string>("");
  const [thankYouDragActive, setThankYouDragActive] = useState(false);
  const thankYouFileInputRef = useRef<HTMLInputElement>(null);

  const [previewEmailOpen, setPreviewEmailOpen] = useState(false);
  const [previewEmailLoading, setPreviewEmailLoading] = useState(false);
  const [previewEmailTemplates, setPreviewEmailTemplates] = useState<EmailPreviewTemplateOption[]>([]);
  const [previewEmailHtml, setPreviewEmailHtml] = useState<string>("");
  const [previewEmailSubject, setPreviewEmailSubject] = useState<string>("");
  const [previewEmailError, setPreviewEmailError] = useState<string>("");

  const { role } = useAuth();
  const isAdmin = role === "Admin";
  const campaignId = params.idOrSlug;
  const apiId = resolvedNumericId?.toString() || queryId || campaignId;

  const investmentTagLinks = useMemo(() => {
    const baseUrl = import.meta.env.VITE_FRONTEND_URL || "";
    return formData.investmentTagValues.map(
      (tag) => `${baseUrl}/investments?tag=${tag.replace(/\s+/g, "-")}`
    );
  }, [formData.investmentTagValues]);

  const isInvestmentTagDirty = useMemo(() => {
    if (formData.investmentTagValues.length !== savedTagValues.length) return true;
    return formData.investmentTagValues.some((t, i) => t !== savedTagValues[i]);
  }, [formData.investmentTagValues, savedTagValues]);

  const isSourcedByDirty = useMemo(() => {
    if (formData.approvedBy.length !== savedApprovedBy.length) return true;
    return formData.approvedBy.slice().sort().join(",") !== savedApprovedBy.slice().sort().join(",");
  }, [formData.approvedBy, savedApprovedBy]);

  const isStageDirty = useMemo(() => {
    return formData.stage !== savedStage;
  }, [formData.stage, savedStage]);

  const updatesDisabled = formData.stage === CLOSED_NOT_INVESTED_STAGE;
  const lastNavigableStepIdx = updatesDisabled
    ? STEPS.length - 2
    : STEPS.length - 1;

  useEffect(() => {
    if (updatesDisabled && currentStep === 5) {
      setCurrentStep(4);
    }
  }, [updatesDisabled, currentStep]);

  const loadCampaignUpdates = useCallback(async () => {
    if (!resolvedNumericId) return;
    setUpdatesLoading(true);
    try {
      const items = await fetchCampaignUpdates(resolvedNumericId);
      setCampaignUpdates(items);
    } catch (err: any) {
      console.error("Failed to load campaign updates:", err);
      toast({ title: "Error", description: err?.message || "Failed to load updates.", variant: "destructive" });
    } finally {
      setUpdatesLoading(false);
    }
  }, [resolvedNumericId, toast]);

  useEffect(() => {
    if (currentStep === 5 && resolvedNumericId && !updatesDisabled) {
      loadCampaignUpdates();
    }
  }, [currentStep, resolvedNumericId, updatesDisabled, loadCampaignUpdates]);

  const resetUpdateForm = () => {
    setUpdateForm({
      subject: "",
      description: "",
      shortDescription: "",
      startDate: "",
      endDate: "",
      attachments: [],
      impactHighlights: emptyImpactHighlights(),
    });
    setUpdateFormErrors({});
    setEditingUpdateId(null);
  };

  const openNewUpdateForm = () => {
    resetUpdateForm();
    setUpdateFormOpen(true);
  };

  // Maps a server-side attachment row into the dialog's "existing" entry.
  const mapExistingAttachment = (a: CampaignUpdateAttachmentItem): UpdateFormAttachment => {
    const isImage =
      (a.mimeType && a.mimeType.startsWith("image/")) ||
      (a.fileUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.fileUrl));
    return {
      kind: "existing",
      id: a.id,
      fileName: a.fileName || (a.filePath.split("/").pop() || "attachment"),
      fileUrl: a.fileUrl,
      previewUrl: isImage ? a.fileUrl : null,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    };
  };

  const openEditUpdateForm = (item: CampaignUpdateItem) => {
    setEditingUpdateId(item.id);
    const existing = (item.attachments || []).map(mapExistingAttachment);
    // Always render exactly IMPACT_HIGHLIGHTS_SLOTS rows; pad / truncate
    // whatever the server returned so the form layout stays stable
    // even for legacy updates with no `impact_highlights` value.
    const loadedHighlights = emptyImpactHighlights();
    if (Array.isArray(item.impactHighlights)) {
      for (let i = 0; i < IMPACT_HIGHLIGHTS_SLOTS; i++) {
        const row = item.impactHighlights[i];
        if (row && typeof row === "object") {
          loadedHighlights[i] = {
            label: typeof row.label === "string" ? row.label : "",
            value: typeof row.value === "string" ? row.value : "",
          };
        }
      }
    }
    setUpdateForm({
      subject: item.subject || "",
      description: item.description || "",
      shortDescription: item.shortDescription || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      attachments: existing,
      impactHighlights: loadedHighlights,
    });
    setUpdateFormErrors({});
    setUpdateFormOpen(true);
  };

  const ALLOWED_ATTACH_MIME = new Set([
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ]);

  // Adds one or more files to the staged attachment list. Each file is
  // independently validated and either appended or causes a per-file error
  // message; valid files in the same selection still go through.
  const handleUpdateAttachFilesAdd = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list: File[] = Array.from(files as ArrayLike<File>);
    if (list.length === 0) return;

    const errors: string[] = [];
    const newEntries: UpdateFormAttachment[] = [];

    for (const file of list) {
      if (!ALLOWED_ATTACH_MIME.has(file.type)) {
        errors.push(`${file.name}: file type not allowed.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        errors.push(`${file.name}: exceeds the 10MB limit.`);
        continue;
      }
      try {
        const isImage = file.type.startsWith("image/");
        const fileForUpload: File = isImage
          ? await compressImage(file, file.type || "image/jpeg")
          : file;
        const base64 = await toBase64(fileForUpload);
        newEntries.push({
          kind: "new",
          tempId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          data: base64,
          fileName: file.name,
          previewUrl: isImage ? base64 : null,
          mimeType: file.type,
          sizeBytes: fileForUpload.size,
        });
      } catch (err) {
        console.error("Failed to read attachment:", err);
        errors.push(`${file.name}: failed to read file.`);
      }
    }

    setUpdateForm((prev) => ({
      ...prev,
      attachments: [...prev.attachments, ...newEntries],
    }));
    setUpdateFormErrors((prev) => {
      const next = { ...prev };
      if (errors.length) {
        next.attachments = errors.join(" ");
      } else {
        delete next.attachments;
      }
      return next;
    });
  };

  // Removes the staged attachment at `index`. Existing rows are simply
  // dropped from the list (their server-side row will be deleted on Save);
  // newly added uploads are discarded.
  const handleRemoveStagedAttachment = (index: number) => {
    setUpdateForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  const validateUpdateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!updateForm.subject.trim()) errs.subject = "Subject is required.";
    if (!updateForm.description || !updateForm.description.replace(/<[^>]+>/g, "").trim()) {
      errs.description = "Description is required.";
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (updateForm.startDate) {
      const s = new Date(updateForm.startDate);
      s.setHours(0, 0, 0, 0);
      if (!isNaN(s.getTime()) && s < today) {
        errs.startDate = "Start date cannot be in the past.";
      }
    }
    if (updateForm.startDate && updateForm.endDate) {
      const s = new Date(updateForm.startDate).getTime();
      const e = new Date(updateForm.endDate).getTime();
      if (!isNaN(s) && !isNaN(e) && e <= s) {
        errs.endDate = "End date must be after the start date.";
      }
    }
    setUpdateFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitUpdateForm = async () => {
    if (!resolvedNumericId) return;
    if (!validateUpdateForm()) return;
    setUpdatesSubmitting(true);
    try {
      const attachmentsPayload: CampaignUpdateAttachmentInput[] =
        updateForm.attachments.map((a) =>
          a.kind === "existing"
            ? { id: a.id }
            : { data: a.data, name: a.fileName || "attachment" }
        );
      const payload = {
        subject: updateForm.subject.trim(),
        description: updateForm.description || null,
        shortDescription: updateForm.shortDescription.trim() || null,
        startDate: updateForm.startDate || null,
        endDate: updateForm.endDate || null,
        attachments: attachmentsPayload,
        // Always send all three slots, trimmed; the backend treats an
        // all-blank array as NULL so empty rows don't pollute the DB.
        impactHighlights: updateForm.impactHighlights.map((h) => ({
          label: (h.label || "").trim(),
          value: (h.value || "").trim(),
        })),
      };
      if (editingUpdateId) {
        const result = await updateCampaignUpdate(resolvedNumericId, editingUpdateId, payload);
        if (result.success === false) throw new Error(result.message || "Failed to save update.");
        toast({ title: "Saved", description: "Update saved successfully." });
      } else {
        const result = await createCampaignUpdate(resolvedNumericId, payload);
        if (result.success === false) throw new Error(result.message || "Failed to create update.");
        toast({ title: "Created", description: "Update created and investors notified." });
      }
      setUpdateFormOpen(false);
      resetUpdateForm();
      await loadCampaignUpdates();
    } catch (err: any) {
      console.error("Failed to submit update:", err);
      toast({ title: "Error", description: err?.message || "Failed to save update.", variant: "destructive" });
    } finally {
      setUpdatesSubmitting(false);
    }
  };

  const confirmSendUpdateEmail = async () => {
    if (!resolvedNumericId || !emailUpdateTarget) return;
    const item = emailUpdateTarget;
    setSendingEmailUpdateId(item.id);
    try {
      const result = await sendCampaignUpdateEmail(resolvedNumericId, item.id);
      if (result.success === false) throw new Error(result.message || "Failed to send email.");
      // 0 eligible recipients: server still returns success and intentionally
      // skips writing a log row. Surface the message but don't pretend any
      // emails went out.
      if ((result.recipientCount ?? 0) === 0) {
        toast({
          title: "No emails sent",
          description: result.message || "No eligible investors to email.",
        });
      } else {
        toast({ title: "Email sent", description: result.message || "Email sent to investors." });
      }
      setEmailUpdateTarget(null);
      // Refresh the underlying list so the email-history modal opened next
      // shows the new log row.
      await loadCampaignUpdates();
    } catch (err: any) {
      console.error("Failed to send update email:", err);
      toast({ title: "Error", description: err?.response?.data?.message || err?.message || "Failed to send email.", variant: "destructive" });
    } finally {
      setSendingEmailUpdateId(null);
    }
  };

  const openEmailLogsModal = async (item: CampaignUpdateItem) => {
    if (!resolvedNumericId) return;
    setEmailLogsTarget(item);
    setEmailLogs([]);
    setEmailLogsLoading(true);
    try {
      const items = await fetchCampaignUpdateEmailLogs(resolvedNumericId, item.id);
      setEmailLogs(items);
    } catch (err: any) {
      console.error("Failed to load email send history:", err);
      toast({
        title: "Error",
        description: err?.response?.data?.message || err?.message || "Failed to load email send history.",
        variant: "destructive",
      });
    } finally {
      setEmailLogsLoading(false);
    }
  };

  // Renders a Date (M/D/YYYY) and a Time labelled with the current EST/EDT
  // offset so admins always see Eastern Time regardless of their browser
  // locale. The DST suffix is derived from the actual offset of the date in
  // America/New_York via Intl.
  const formatEasternDate = (iso: string): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(d);
    } catch {
      return iso;
    }
  };
  const formatEasternTime = (iso: string): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(d);
    } catch {
      return iso;
    }
  };

  const confirmDeleteUpdate = async () => {
    if (!resolvedNumericId || !deleteUpdateTarget) return;
    const item = deleteUpdateTarget;
    setDeletingUpdateId(item.id);
    try {
      const result = await deleteCampaignUpdate(resolvedNumericId, item.id);
      if (result.success === false) throw new Error(result.message || "Failed to delete update.");
      toast({ title: "Deleted", description: "Update deleted successfully." });
      setDeleteUpdateTarget(null);
      await loadCampaignUpdates();
    } catch (err: any) {
      console.error("Failed to delete update:", err);
      toast({ title: "Error", description: err?.message || "Failed to delete update.", variant: "destructive" });
    } finally {
      setDeletingUpdateId(null);
    }
  };

  const getStageLabel = (val: string | null | undefined) => {
    if (!val) return "None";
    return STAGE_OPTIONS.find((s) => s.value === val)?.label ?? val;
  };

  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return adminUsers;
    const q = mentionQuery.toLowerCase();
    return adminUsers.filter((u) => u.fullName.toLowerCase().includes(q));
  }, [adminUsers, mentionQuery]);

  const fullNameRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const websiteRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const propertyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const raisedRef = useRef<HTMLDivElement>(null);
  const minInvestRef = useRef<HTMLDivElement>(null);
  const corporateBankAccountRef = useRef<HTMLDivElement>(null);
  const personalFinancialBenefitRef = useRef<HTMLDivElement>(null);
  const regulatoryIssuesRef = useRef<HTMLDivElement>(null);
  const goodLegalStandingRef = useRef<HTMLDivElement>(null);

  const REQUIRED_FIELDS: (keyof FormData)[] = ["name", "website", "target", "property", "stage", "addedTotalAdminRaised", "minimumInvestment"];
  const FIELD_REFS: Record<string, React.RefObject<HTMLDivElement>> = {
    name: nameRef,
    website: websiteRef,
    target: targetRef,
    property: propertyRef,
    stage: stageRef,
    addedTotalAdminRaised: raisedRef,
    minimumInvestment: minInvestRef,
    hasCorporateBankAccount: corporateBankAccountRef,
    hasPersonalFinancialBenefit: personalFinancialBenefitRef,
    hasRegulatoryIssues: regulatoryIssuesRef,
    isInGoodLegalStanding: goodLegalStandingRef,
  };
  const FIELD_STEPS: Record<string, number> = {
    name: 1,
    website: 1,
    target: 1,
    property: 3,
    stage: 3,
    addedTotalAdminRaised: 3,
    minimumInvestment: 3,
    hasCorporateBankAccount: 0,
    hasPersonalFinancialBenefit: 0,
    hasRegulatoryIssues: 0,
    isInGoodLegalStanding: 0,
  };

  const scrollToField = (field: string) => {
    const fieldStep = FIELD_STEPS[field];
    if (typeof fieldStep === "number" && fieldStep !== currentStep) {
      setCurrentStep(fieldStep);
    }

    window.setTimeout(() => {
      FIELD_REFS[field]?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  };

  useEffect(() => {
    if (!campaignId) return;
    const load = async () => {
      setLoading(true);
      try {
        const fetchId = apiId!;
        const [countriesData, groupsData, investmentDetail, staticTermsData] = await Promise.all([
          fetchCountries(),
          fetchAllGroups(),
          fetchInvestmentById(fetchId),
          fetchStaticValues(),
        ]);

        let investmentData: any = null;
        try {
          investmentData = await fetchInvestmentData();
          setInvestmentDataFailed(false);
        } catch (invDataErr) {
          console.error("Failed to load investment data (tags, themes, etc.):", invDataErr);
          setInvestmentDataFailed(true);
          toast({ title: "Warning", description: "Some filter options failed to load. You can still edit other fields.", variant: "destructive" });
        }

        const resolvedId = investmentDetail?.id ?? 0;
        if (resolvedId) {
          setResolvedNumericId(resolvedId);
        }
        const investmentOptionsData = await fetchAllInvestmentNameList(0, resolvedId);

        setCountries(countriesData || []);
        setGroups(groupsData || []);
        setInvestmentOptions(investmentOptionsData || []);
        setThemes(investmentData?.theme || []);
        setSdgs(investmentData?.sdg || []);
        setSdgOptions(investmentData?.sdg || []);
        setInvestmentTypes(investmentData?.investmentType || []);
        setAllTagOptions(investmentData?.investmentTag || []);
        setApprovedByOptions(investmentData?.approvedBy || []);
        setStaticTerms(staticTermsData || []);

        try {
          const admins = await fetchAllAdminUsers();
          setAdminUsers(admins || []);
        } catch {
          console.error("Failed to load admin users for mentions");
        }

        if (investmentDetail) {
          mapCampaignToState(investmentDetail);
        }
      } catch (err) {
        console.error("Failed to load investment", err);
        toast({ title: "Error", description: "Failed to load investment.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [campaignId]);

  const retryLoadInvestmentData = async () => {
    try {
      const investmentData = await fetchInvestmentData();
      setThemes(investmentData?.theme || []);
      setSdgs(investmentData?.sdg || []);
      setSdgOptions(investmentData?.sdg || []);
      setInvestmentTypes(investmentData?.investmentType || []);
      setAllTagOptions(investmentData?.investmentTag || []);
      setApprovedByOptions(investmentData?.approvedBy || []);
      setInvestmentDataFailed(false);
      toast({ title: "Success", description: "Filter options loaded successfully." });
    } catch (err) {
      console.error("Retry failed to load investment data:", err);
      toast({ title: "Error", description: "Failed to load filter options. Please try again.", variant: "destructive" });
    }
  };

  const mapCampaignToState = useCallback((data: any) => {
    const closeDate = data.fundraisingCloseDate ?? "";
    const isEvergreen = closeDate === "Evergreen";
    const rawTags = data.investmentTag ?? [];
    const tagValues = Array.isArray(rawTags)
      ? rawTags.map((t: any) => (typeof t === "string" ? t : t.tag ?? "")).filter(Boolean)
      : [];

    setInvestmentName(data.name ?? "");
    if (data.logoFileName) setLogoFileName(data.logoFileName);
    if (data.imageFileName) setImageFileName(data.imageFileName);
    if (data.tileImageFileName) setTileImageFileName(data.tileImageFileName);
    if (data.originalPdfFileName) setOriginalPdfFileName(data.originalPdfFileName);
    if (data.pdfFileName) setPdfFileName(data.pdfFileName);

    if (Array.isArray(data.investmentNotes)) {
      setInvestmentNotes(data.investmentNotes.map((n: any) => ({
        ...n,
        date: n.date || formatDate(n.createdAt),
      })));
    }

    setFormData({
      id: data.id,
      contactInfoFullName: data.contactInfoFullName ?? "",
      email: data.contactInfoEmailAddress ?? data.email ?? "",
      investmentInfoEmail: data.investmentInformationalEmail ?? data.investmentInfoEmail ?? "",
      investmentNotificationRecipients:
        Array.isArray(data.investmentNotificationRecipients) && data.investmentNotificationRecipients.length > 0
          ? data.investmentNotificationRecipients.map((r: any) => ({
              name: r?.name ?? "",
              email: r?.email ?? "",
            }))
          : [{ name: "", email: "" }],
      contactInfoPhoneNumber: data.contactInfoPhoneNumber ?? "",
      impactAssetsFundingStatus: (data.impactAssetsFundingStatus && data.impactAssetsFundingStatus.toLowerCase() === "yes") ? "Yes" : (data.impactAssetsFundingStatus && data.impactAssetsFundingStatus.toLowerCase() === "not sure") ? "Not sure" : "No",
      hasCorporateBankAccount: data.hasCorporateBankAccount === true ? "Yes" : data.hasCorporateBankAccount === false ? "No" : "",
      hasPersonalFinancialBenefit: data.hasPersonalFinancialBenefit === true ? "Yes" : data.hasPersonalFinancialBenefit === false ? "No" : "",
      personalFinancialBenefitDescription: data.personalFinancialBenefitDescription ?? "",
      hasRegulatoryIssues: data.hasRegulatoryIssues === true ? "Yes" : data.hasRegulatoryIssues === false ? "No" : "",
      regulatoryIssuesDescription: data.regulatoryIssuesDescription ?? "",
      isInGoodLegalStanding: data.isInGoodLegalStanding === true ? "Yes" : data.isInGoodLegalStanding === false ? "No" : "",
      country: data.country ?? "",
      address1: data.contactInfoAddress ?? "",
      address2: data.contactInfoAddress2 ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
      zipCode: data.zipCode ?? "",
      otherCountryAddress: data.otherCountryAddress ?? "",
      networkDescription: data.networkDescription ?? "",
      referredToCataCap: data.referredToCataCap ?? "",
      investmentRole: data.investmentRole ?? "Company/Fund Executive",
      name: data.name ?? "",
      website: data.website ?? "",
      target: String(data.target ?? ""),
      minimumInvestment: String(data.minimumInvestment ?? ""),
      expectedTotal: data.expectedTotal != null ? String(data.expectedTotal) : "",
      missionVision: data.missionAndVision ?? data.missionVision ?? "",
      isEvergreen,
      fundraisingCloseDate: isEvergreen ? "" : (closeDate ?? ""),
      personalizedThankYou: data.personalizedThankYou ?? "",
      themeIds: parseIds(data.themes),
      sdgIds: parseIds(data.sdGs),
      investmentTypeIds: parseIds(data.investmentTypes),
      description: data.description ?? "",
      terms: data.terms ?? "",
      featuredInvestment: data.featuredInvestment ?? false,
      approvedBy: data.approvedBy ? Array.from(new Set(String(data.approvedBy).split(",").map((s: string) => s.trim()).filter(Boolean))) : [],
      property: data.property ?? "",
      stage: data.stage != null ? String(data.stage) : "",
      privateGroupID: data.groupForPrivateAccessDto?.id ? String(data.groupForPrivateAccessDto.id) : "",
      ownerGroupId: data.ownerGroupId != null ? String(data.ownerGroupId) : "",
      autoEnrollInvestors: !!data.autoEnrollInvestors,
      associatedFundId: data.associatedFundId ?? null,
      isActive: !!data.isActive,
      isPartOfFund: data.isPartOfFund ?? false,
      investmentTagValues: tagValues,
      addedTotalAdminRaised: data.addedTotalAdminRaised != null ? String(data.addedTotalAdminRaised) : "",
      investmentTypeCategory: data.investmentTypeCategory ?? "",
      equityValuation: data.equityValuation != null ? String(data.equityValuation) : "",
      equitySecurityType: data.equitySecurityType ?? "",
      fundTerm: data.fundTerm ?? "",
      equityTargetReturn: data.equityTargetReturn != null ? String(data.equityTargetReturn) : "",
      debtPaymentFrequency: data.debtPaymentFrequency ?? "",
      debtMaturityDate: data.debtMaturityDate ?? "",
      debtInterestRate: data.debtInterestRate != null ? String(data.debtInterestRate) : "",
      metaTitle: data.metaTitle || "",
      metaDescription: data.metaDescription || ""
    });
    setSavedTagValues(tagValues);
    setSavedApprovedBy(data.approvedBy ? Array.from(new Set(String(data.approvedBy).split(",").map((s: string) => s.trim()).filter(Boolean))) : []);
    setSavedStage(data.stage != null ? String(data.stage) : "");

    const incomingAttachments: ThankYouAttachment[] = Array.isArray(data.thankYouAttachments)
      ? data.thankYouAttachments.map((a: any) => ({
          id: Number(a.id),
          fileName: String(a.fileName || ""),
          contentType: String(a.contentType || ""),
          sizeBytes: Number(a.sizeBytes) || 0,
          publicUrl: a.publicUrl || null,
          filePath: a.filePath || "",
          sortOrder: a.sortOrder ?? null,
        }))
      : [];
    setThankYouExistingAttachments(incomingAttachments);
    setThankYouRemovedIds([]);
    setThankYouPendingFiles([]);
    setThankYouAttachmentError("");
  }, [toast]);

  const upd = (field: keyof FormData, value: any) => {
    let finalValue = value;
    const numericFields: (keyof FormData)[] = ["addedTotalAdminRaised", "minimumInvestment", "target", "expectedTotal"];
    if (numericFields.includes(field) && typeof value === "string") {
      const num = parseFloat(value);
      const minVal = (field === "target" || field === "minimumInvestment") ? 1 : 0;
      if (!isNaN(num) && num < minVal) {
        finalValue = minVal.toString();
      }
    }
    setFormData((prev) => ({ ...prev, [field]: finalValue }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: false }));
    if (field === "property") setPropertyError("");
  };

  const toggleId = (field: "themeIds" | "sdgIds" | "investmentTypeIds", id: number) => {
    setFormData((prev) => {
      const arr = prev[field] as number[];
      return { ...prev, [field]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  };

  const toggleApprover = (id: string) => {
    setFormData((prev) => {
      const arr = prev.approvedBy;
      return { ...prev, approvedBy: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  };

  const toggleTagValue = (tag: string) => {
    setFormData((prev) => {
      const arr = prev.investmentTagValues;
      return { ...prev, investmentTagValues: arr.includes(tag) ? arr.filter((x) => x !== tag) : [...arr, tag] };
    });
  };

  const validate = (): boolean => {
    const newErrors: Record<string, boolean> = {};
    let valid = true;
    REQUIRED_FIELDS.forEach((f) => {
      const val = formData[f];
      const empty = typeof val === "string" ? val.trim() === "" : !val;
      if (empty) { newErrors[f] = true; valid = false; }
    });
    setErrors(newErrors);
    if (!valid) {
      const allRequired = [...REQUIRED_FIELDS];
      const first = allRequired.find((f) => newErrors[f]);
      if (first) {
        scrollToField(first);
      }
      return false;
    }
    if (!investmentOwnerValid) {
      toast({
        title: "Invalid Investment Owner",
        description: "User with such email address does not exist. Please pick an existing user.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const uploadLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!isValidImage(file)) { setFileErrors(p => ({ ...p, logo: "Only .png, .jpg, .gif files allowed." })); return; }
    if (file.size >= 10485760) { setFileErrors(p => ({ ...p, logo: "File must be under 10 MB." })); return; }
    setFileErrors(p => ({ ...p, logo: "" }));
    const compressed = await compressImage(file, file.type);
    setLogoFile(compressed);
    setLogoFileName("");
    toBase64(compressed).then((res) => setLogo(res));
  };

  const uploadImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!isValidImage(file)) { setFileErrors(p => ({ ...p, profile: "Only .png, .jpg, .gif files allowed." })); return; }
    if (file.size >= 10485760) { setFileErrors(p => ({ ...p, profile: "File must be under 10 MB." })); return; }
    setFileErrors(p => ({ ...p, profile: "" }));
    const compressed = await compressImage(file, file.type);
    if (!cropProfileEnabled) {
      const base64 = await toBase64(compressed);
      setProfileFile(compressed);
      setImage(base64);
      setImageFileName("");
      return;
    }
    setCropperImage(URL.createObjectURL(compressed));
    setCropperTarget("profile");
    setCropperAspect(763 / 400);
    setCropperOpen(true);
  };

  const uploadTileImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!isValidImage(file)) { setFileErrors(p => ({ ...p, tile: "Only .png, .jpg, .gif files allowed." })); return; }
    if (file.size >= 10485760) { setFileErrors(p => ({ ...p, tile: "File must be under 10 MB." })); return; }
    setFileErrors(p => ({ ...p, tile: "" }));
    const compressed = await compressImage(file, file.type);
    if (!cropTileEnabled) {
      const base64 = await toBase64(compressed);
      setSmallerFile(compressed);
      setTileImage(base64);
      setTileImageFileName("");
      return;
    }
    setCropperImage(URL.createObjectURL(compressed));
    setCropperTarget("tile");
    setCropperAspect(362 / 250);
    setCropperOpen(true);
  };

  const handleCropSave = useCallback(async (file: File, previewUrl: string) => {
    const base64 = await toBase64(file);
    if (cropperTarget === "profile") { setProfileFile(file); setImage(base64); setImageFileName(""); }
    else if (cropperTarget === "tile") { setSmallerFile(file); setTileImage(base64); setTileImageFileName(""); }
    setCropperOpen(false);
    setCropperImage(null);
    setCropperTarget(null);
  }, [cropperTarget]);

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { setFileErrors(p => ({ ...p, pdf: "Only .pdf files allowed." })); return; }
    if (file.size >= 20971520) { setFileErrors(p => ({ ...p, pdf: "File must be under 20 MB." })); return; }
    setFileErrors(p => ({ ...p, pdf: "" }));
    setPitchDeckFile(file);
    setOriginalPdfFileName(file.name);
    setPdfFileName("");
    toBase64(file).then((res) => setPdf(res));
  };

  const handleDownloadPdf = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!pdfFileName || !originalPdfFileName) {
        if (pitchDeckFile) {
            toast({
                title: "Local File",
                description: "This file has not been uploaded to the server yet.",
                variant: "default"
            });
        }
        return;
    }

    setIsDownloadingPdf(true);
    try {
        await downloadInvestmentDocument("download", pdfFileName, originalPdfFileName);
    } catch (error) {
        console.error("Failed to download document", error);
        toast({
            title: "Error",
            description: "Failed to download pitch deck. Please try again.",
            variant: "destructive"
        });
    } finally {
        setIsDownloadingPdf(false);
    }
  };

  const thankYouUsedBytes = useMemo(() => {
    const keptBytes = thankYouExistingAttachments
      .filter((a) => !thankYouRemovedIds.includes(a.id))
      .reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
    const newBytes = thankYouPendingFiles.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
    return keptBytes + newBytes;
  }, [thankYouExistingAttachments, thankYouRemovedIds, thankYouPendingFiles]);

  const handleThankYouFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const accepted: PendingThankYouAttachment[] = [];
      const errors: string[] = [];
      let runningTotal = thankYouUsedBytes;

      for (const file of incoming) {
        const mime = (file.type || "").toLowerCase();
        const okByMime = THANK_YOU_ALLOWED_MIME_TYPES.has(mime);
        const okByExt = THANK_YOU_ALLOWED_EXT_REGEX.test(file.name);
        if (!okByMime && !okByExt) {
          errors.push(`"${file.name}" — unsupported file type. Allowed: PDF, DOC, DOCX, PNG, JPG, WEBP.`);
          continue;
        }
        if (file.size > THANK_YOU_PER_FILE_MAX_BYTES) {
          errors.push(`"${file.name}" exceeds the 10 MB per-file limit.`);
          continue;
        }
        if (runningTotal + file.size > THANK_YOU_TOTAL_MAX_BYTES) {
          errors.push(`"${file.name}" would exceed the 25 MB total attachment limit.`);
          continue;
        }
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (!dataUrl) {
            errors.push(`"${file.name}" could not be read.`);
            continue;
          }
          const resolvedMime = mime || dataUrl.match(/^data:([^;]+);base64/)?.[1] || "application/octet-stream";
          accepted.push({
            localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            fileName: file.name,
            contentType: resolvedMime,
            sizeBytes: file.size,
            dataBase64: dataUrl,
          });
          runningTotal += file.size;
        } catch {
          errors.push(`"${file.name}" could not be read.`);
        }
      }

      if (accepted.length > 0) {
        setThankYouPendingFiles((prev) => [...prev, ...accepted]);
      }
      setThankYouAttachmentError(errors.join(" "));
    },
    [thankYouUsedBytes],
  );

  const handleThankYouFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const files = target.files;
    if (files && files.length > 0) {
      void handleThankYouFiles(files);
    }
    target.value = "";
  };

  const handleThankYouDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setThankYouDragActive(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      void handleThankYouFiles(files);
    }
  };

  const removeExistingThankYouAttachment = (id: number) => {
    setThankYouRemovedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setThankYouAttachmentError("");
  };

  const undoRemoveExistingThankYouAttachment = (id: number) => {
    setThankYouRemovedIds((prev) => prev.filter((rid) => rid !== id));
  };

  const removePendingThankYouAttachment = (localId: string) => {
    setThankYouPendingFiles((prev) => prev.filter((f) => f.localId !== localId));
    setThankYouAttachmentError("");
  };

  const buildPreviewVariables = useCallback((category: number): Record<string, string> => {
    const investmentLabel = formData.name || investmentName || "this investment";
    const exampleAmount = "$1,000";
    const today = dayjs().format("MMMM D, YYYY");
    const vars: Record<string, string> = {
      firstName: "Sample Donor",
      lastName: "Donor",
      fullName: "Sample Donor",
      email: "donor@example.com",
      formattedAmount: exampleAmount,
      amount: exampleAmount,
      donationAmount: exampleAmount,
      donationRecipient: investmentLabel,
      campaignName: investmentLabel,
      investmentName: investmentLabel,
      investmentScenario: investmentLabel,
      investmentScenarios: investmentLabel,
      dafProviderName: "Sample DAF Provider",
      dafName: "Sample DAF Provider",
      dafProviderLink: "https://example.com/daf",
      foundationName: "Sample Foundation",
      date: today,
      donationDate: today,
      logoUrl: "",
      requestOrigin: typeof window !== "undefined" ? window.location.origin : "",
    };
    if (category === DONATION_CONFIRMATION_CATEGORY) {
      const personalizedHtml = (formData.personalizedThankYou || "").trim();
      vars.personalizedThankYouSection = personalizedHtml
        ? `<b style="color:#000;">Thank you from Investment Owner</b><br/>${personalizedHtml}<hr style="border:none; border-top:1px solid #d1d5db;" />`
        : "";
    }
    return vars;
  }, [formData.name, formData.personalizedThankYou, investmentName]);

  const applyTemplatePlaceholders = useCallback(
    (html: string, vars: Record<string, string>): string => {
      if (!html) return "";
      return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name) => {
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          return vars[name];
        }
        return "";
      });
    },
    [],
  );

  const loadEmailPreviewForCategory = useCallback(
    async (category: number, options: EmailPreviewTemplateOption[]) => {
      const opt = options.find((o) => o.category === category);
      if (!opt) {
        setPreviewEmailHtml("");
        setPreviewEmailSubject("");
        setPreviewEmailError("No active template configured for this category.");
        return;
      }
      setPreviewEmailLoading(true);
      setPreviewEmailError("");
      try {
        const data = await fetchEmailTemplatePreview(opt.templateId);
        const vars = buildPreviewVariables(category);
        setPreviewEmailSubject(applyTemplatePlaceholders(data.subject || "", vars));
        setPreviewEmailHtml(applyTemplatePlaceholders(data.bodyHtml || "", vars));
      } catch (err: any) {
        console.error("Failed to load email template preview", err);
        setPreviewEmailHtml("");
        setPreviewEmailSubject("");
        setPreviewEmailError(err?.response?.data?.message || "Failed to load template preview.");
      } finally {
        setPreviewEmailLoading(false);
      }
    },
    [applyTemplatePlaceholders, buildPreviewVariables],
  );

  const openPreviewEmail = async () => {
    setPreviewEmailOpen(true);
    setPreviewEmailLoading(true);
    setPreviewEmailError("");
    setPreviewEmailHtml("");
    setPreviewEmailSubject("");
    try {
      const results = await Promise.all(
        EMAIL_PREVIEW_CATEGORIES.map(async ({ category, label }) => {
          try {
            const tpl = await fetchActiveEmailTemplateByCategory(category);
            if (!tpl) return null;
            return {
              category,
              templateId: tpl.id,
              name: tpl.name,
              label,
            } as EmailPreviewTemplateOption;
          } catch {
            return null;
          }
        }),
      );
      const opts = results.filter((r): r is EmailPreviewTemplateOption => r !== null);
      setPreviewEmailTemplates(opts);
      if (opts.length === 0) {
        setPreviewEmailError("No active templates are configured for the selected categories.");
        setPreviewEmailLoading(false);
        return;
      }
      const initial = opts[0].category;
      await loadEmailPreviewForCategory(initial, opts);
    } catch (err: any) {
      console.error("Failed to load email preview templates", err);
      setPreviewEmailError(err?.response?.data?.message || "Failed to load email templates.");
      setPreviewEmailLoading(false);
    }
  };

  const handleSaveClick = () => {
    if (!validate()) {
      toast({ title: "Required Fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    setNoteText("");
    setTaggedUserNames([]);
    setTaggedUserEmails([]);
    setMentionOpen(false);
    setMentionStartIndex(null);
    setMentionQuery("");
    setHighlightedIndex(0);
    setNoteDialogOpen(true);
  };

  const handleSave = async (note: string | null) => {
    setNoteDialogOpen(false);
    setIsSubmitting(true);

    let processedNote = note;
    if (processedNote && taggedUserNames.length > 0) {
      taggedUserNames.forEach((name) => {
        const pattern = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        processedNote = processedNote!.replace(pattern, `<b>${name}</b>`);
      });
    }
    try {
      const payload: Record<string, any> = {
        id: formData.id,
        contactInfoFullName: formData.contactInfoFullName?.trim(),
        contactInfoEmailAddress: formData.email?.trim(),
        investmentInformationalEmail: formData.investmentInfoEmail?.trim(),
        contactInfoPhoneNumber: formData.contactInfoPhoneNumber?.trim(),
        impactAssetsFundingStatus: formData.impactAssetsFundingStatus?.trim(),
        hasCorporateBankAccount: formData.hasCorporateBankAccount === "Yes" ? true : formData.hasCorporateBankAccount === "No" ? false : null,
        hasPersonalFinancialBenefit: formData.hasPersonalFinancialBenefit === "Yes" ? true : formData.hasPersonalFinancialBenefit === "No" ? false : null,
        personalFinancialBenefitDescription: formData.hasPersonalFinancialBenefit === "Yes" ? (formData.personalFinancialBenefitDescription?.trim() || null) : null,
        hasRegulatoryIssues: formData.hasRegulatoryIssues === "Yes" ? true : formData.hasRegulatoryIssues === "No" ? false : null,
        regulatoryIssuesDescription: formData.hasRegulatoryIssues === "Yes" ? (formData.regulatoryIssuesDescription?.trim() || null) : null,
        isInGoodLegalStanding: formData.isInGoodLegalStanding === "Yes" ? true : formData.isInGoodLegalStanding === "No" ? false : null,
        country: formData.country?.trim(),
        networkDescription: formData.networkDescription?.trim(),
        referredToCataCap: formData.referredToCataCap?.trim(),
        investmentRole: formData.investmentRole?.trim(),
        name: formData.name?.trim(),
        website: formData.website?.trim(),
        target: formData.target ? String(formData.target).trim() : null,
        minimumInvestment: formData.minimumInvestment ? String(formData.minimumInvestment).trim() : null,
        expectedTotal: formData.expectedTotal ? Number(formData.expectedTotal) : null,
        missionAndVision: formData.missionVision?.trim(),
        fundraisingCloseDate: formData.isEvergreen ? "Evergreen" : formData.fundraisingCloseDate?.trim(),
        personalizedThankYou: formData.personalizedThankYou?.trim(),
        themes: formData.themeIds.join(","),
        sdGs: formData.sdgIds.join(","),
        investmentTypes: formData.investmentTypeIds.join(","),
        description: formData.description?.trim(),
        terms: formData.terms?.trim(),
        featuredInvestment: formData.featuredInvestment,
        approvedBy: formData.approvedBy.join(","),
        property: formData.property?.trim() || null,
        stage: formData.stage ? Number(formData.stage) : null,
        groupForPrivateAccessDto: formData.privateGroupID
          ? groups.find((item) => Number(item.id) === Number(formData.privateGroupID))
          : undefined,
        ownerGroupId: formData.ownerGroupId ? Number(formData.ownerGroupId) : null,
        autoEnrollInvestors: !!formData.autoEnrollInvestors,
        associatedFundId: formData.isPartOfFund ? formData.associatedFundId : null,
        isActive: formData.isActive,
        isPartOfFund: formData.isPartOfFund,
        investmentTag: formData.investmentTagValues.map((t) => ({ tag: t })),
        addedTotalAdminRaised: formData.addedTotalAdminRaised ? String(formData.addedTotalAdminRaised) : "0",
        investmentTypeCategory: formData.investmentTypeCategory || null,
        equityValuation: formData.equityValuation ? Number(String(formData.equityValuation).replace(/,/g, "")) : null,
        equitySecurityType: formData.equitySecurityType?.trim() || null,
        fundTerm: formData.fundTerm?.trim() || null,
        equityTargetReturn: formData.equityTargetReturn ? Number(String(formData.equityTargetReturn).replace(/[^0-9.]/g, "")) : null,
        debtPaymentFrequency: formData.debtPaymentFrequency?.trim() || null,
        debtMaturityDate: formData.debtMaturityDate?.trim() || null,
        debtInterestRate: formData.debtInterestRate ? Number(String(formData.debtInterestRate).replace(/[^0-9.]/g, "")) : null,
        metaTitle: formData.metaTitle?.trim(),
        metaDescription: formData.metaDescription?.trim(),
        investmentNotificationRecipients: (formData.investmentNotificationRecipients || [])
          .map((r) => ({ name: (r.name || "").trim(), email: (r.email || "").trim().toLowerCase() }))
          .filter((r) => r.email && r.email.includes("@")),
        tileImage: tileImage || "",
        image: image || "",
        pdfPresentation: pdf || "",
        logo: logo || "",
        originalPdfFileName: originalPdfFileName || "",
        pdfFileName: pdfFileName || "",
        logoFileName: logoFileName || "",
        imageFileName: imageFileName || "",
        tileImageFileName: tileImageFileName || "",
        note: processedNote || null,
        noteEmail: taggedUserEmails.length > 0 ? taggedUserEmails : null,
        oldStatus: isStageDirty ? (getStageLabel(savedStage) || null) : null,
        newStatus: isStageDirty ? (getStageLabel(formData.stage) || null) : null,
        contactInfoAddress: formData.address1?.trim() || "",
        contactInfoAddress2: formData.address2?.trim() || "",
        city: formData.city?.trim() || "",
        state: formData.state?.trim() || "",
        zipCode: formData.zipCode?.trim() || "",
        otherCountryAddress: "",
        thankYouAttachmentIdsToRemove: thankYouRemovedIds,
        thankYouAttachmentsToAdd: thankYouPendingFiles.map((f) => ({
          fileName: f.fileName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          dataBase64: f.dataBase64,
        })),
      };

      const result = await updateInvestment(formData.id!, payload);

      if (result && result.success === false) {
        if (result.message?.toLowerCase().includes("url") || result.message?.toLowerCase().includes("property")) {
          setPropertyError(result.message);
          setErrors((prev) => ({ ...prev, property: true }));
          scrollToField("property");
        }
        toast({ title: "Update Failed", description: result.message || "Failed to update investment.", variant: "destructive" });
        setIsSubmitting(false);
        return;
      }

      if (result && result.campaign) {
        mapCampaignToState(result.campaign);
        
        // Reset local file selection states
        setLogoFile(null);
        setProfileFile(null);
        setSmallerFile(null);
        setPitchDeckFile(null);
        
        // Clear local base64 previews
        setLogo(undefined);
        setImage(undefined);
        setTileImage(undefined);
        setPdf(undefined);

        const savedId = result.campaign.id;
        if (savedId) {
          setResolvedNumericId(savedId);
        }
        const newSlug = result.campaign.property || result.campaign.id;
        if (newSlug && String(newSlug) !== campaignId) {
          setLocation(`/raisemoney/edit/${newSlug}?id=${savedId || resolvedNumericId || ""}`, { replace: true });
        }
      }

      toast({ title: "Investment Updated", description: "Investment has been updated successfully." });
    } catch {
      toast({ title: "Update Failed", description: "Could not update investment. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fe = (field: keyof FormData) => errors[field] ? "border-[#f06548] focus-visible:ring-[#f06548]" : "";


  if (loading) {
    return (
      <AdminLayout title="Edit Investment">
        <div className="max-w-8xl mx-auto">
          <div className="space-y-2 mb-4">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-7 w-64" />
          </div>
          <Skeleton className="h-16 w-full rounded-b-none rounded-t-xl" />
          <Skeleton className="h-[520px] w-full rounded-t-none rounded-b-xl" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Edit Investment">
      {cropperOpen && cropperImage && (
        <BannerCropper
          image={cropperImage}
          aspect={cropperAspect}
          onCancel={() => { setCropperOpen(false); setCropperImage(null); setCropperTarget(null); }}
          onCropped={handleCropSave}
        />
      )}

      <Dialog open={previewEmailOpen} onOpenChange={setPreviewEmailOpen}>
        <DialogContent className="max-w-4xl max-h-[95vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle data-testid="text-preview-email-title">Preview Email</DialogTitle>
            {previewEmailSubject && (
              <p className="text-sm text-muted-foreground" data-testid="text-preview-email-subject">
                Subject: {previewEmailSubject}
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 min-h-0 px-0">
            {previewEmailLoading ? (
              <div className="flex items-center justify-center h-[600px] text-sm text-muted-foreground">
                Loading preview…
              </div>
            ) : previewEmailError ? (
              <div className="flex items-center justify-center h-[600px] text-sm text-[#f06548] px-6 text-center" data-testid="text-preview-email-error">
                {previewEmailError}
              </div>
            ) : previewEmailHtml ? (
              <iframe
                title="Email Preview"
                className="w-full h-full min-h-[600px] border-0 bg-white"
                srcDoc={previewEmailHtml}
                sandbox=""
                data-testid="iframe-preview-email"
              />
            ) : (
              <div className="flex items-center justify-center h-[600px] text-sm text-muted-foreground">
                Select a template to preview.
              </div>
            )}
          </div>
          <DialogFooter className="p-4 border-t bg-white dark:bg-muted/10">
            <Button variant="outline" onClick={() => setPreviewEmailOpen(false)} data-testid="button-close-preview-email">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteDialogOpen} onOpenChange={(open) => { if (!open) setNoteDialogOpen(false); }}>
        <DialogContent
          className="sm:max-w-[750px]"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {isStageDirty ? "Confirm Investment Stage Change" : "Confirm Update"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isStageDirty && (
              <p className="text-sm">
                Investment Stage changed from <strong>{getStageLabel(savedStage)}</strong> to{" "}
                <strong>{getStageLabel(formData.stage)}</strong>
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm">Note</Label>
              <div className="relative">
                <Textarea
                  ref={noteTextareaRef}
                  placeholder="Write a note (optional)… Use @ to mention users"
                  value={noteText}
                  onChange={(e) => {
                    const val = e.target.value;
                    const cursor = e.target.selectionStart;
                    setNoteText(val);

                    const textBefore = val.slice(0, cursor);
                    const atIndex = textBefore.lastIndexOf("@");
                    if (atIndex !== -1) {
                      const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
                      if (charBefore === " " || charBefore === "\n" || atIndex === 0) {
                        const query = textBefore.slice(atIndex + 1);
                        if (!/\s/.test(query)) {
                          setMentionStartIndex(atIndex);
                          setMentionQuery(query);
                          setMentionOpen(true);
                          setHighlightedIndex(0);
                          return;
                        }
                      }
                    }
                    setMentionOpen(false);
                    setMentionStartIndex(null);
                  }}
                  onKeyDown={(e) => {
                    if (!mentionOpen) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHighlightedIndex((prev) => Math.min(prev + 1, filteredMentionUsers.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Enter" && filteredMentionUsers.length > 0) {
                      e.preventDefault();
                      const user = filteredMentionUsers[highlightedIndex];
                      if (user && mentionStartIndex !== null) {
                        const before = noteText.slice(0, mentionStartIndex);
                        const after = noteText.slice(mentionStartIndex + 1 + mentionQuery.length);
                        setNoteText(`${before}@${user.fullName} ${after}`);
                        if (user.alternateEmail && !taggedUserEmails.includes(user.alternateEmail)) {
                          setTaggedUserEmails((prev) => [...prev, user.alternateEmail!]);
                        }
                        if (user.fullName && !taggedUserNames.includes(user.fullName)) {
                          setTaggedUserNames((prev) => [...prev, user.fullName]);
                        }
                        setMentionOpen(false);
                        setMentionStartIndex(null);
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionOpen(false);
                      setMentionStartIndex(null);
                    }
                  }}
                  rows={5}
                  className="resize-none"
                  maxLength={1000}
                  data-testid="input-save-note"
                />
                {mentionOpen && filteredMentionUsers.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 w-64 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md z-50">
                    {filteredMentionUsers.map((user, idx) => (
                      <button
                        key={user.id}
                        type="button"
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer",
                          idx === highlightedIndex && "bg-accent"
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (mentionStartIndex !== null) {
                            const before = noteText.slice(0, mentionStartIndex);
                            const after = noteText.slice(mentionStartIndex + 1 + mentionQuery.length);
                            setNoteText(`${before}@${user.fullName} ${after}`);
                            if (user.alternateEmail && !taggedUserEmails.includes(user.alternateEmail)) {
                              setTaggedUserEmails((prev) => [...prev, user.alternateEmail!]);
                            }
                            if (user.fullName && !taggedUserNames.includes(user.fullName)) {
                              setTaggedUserNames((prev) => [...prev, user.fullName]);
                            }
                            setMentionOpen(false);
                            setMentionStartIndex(null);
                          }
                        }}
                      >
                        {user.fullName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)} data-testid="button-note-cancel">
              Cancel
            </Button>
            {noteText.trim() ? (
              <Button
                className="bg-[#405189] hover:bg-[#364574] text-white"
                onClick={() => handleSave(noteText.trim())}
                data-testid="button-note-update"
              >
                Update
              </Button>) : (
              <Button
                variant="secondary"
                onClick={() => handleSave(null)}
                data-testid="button-note-skip"
              >
                Skip
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="max-w-8xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <button
              className="inline-flex items-center gap-1.5 text-[#405189] text-sm font-medium mb-1 hover:underline"
              onClick={() => window.history.back()}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h4 className="text-base font-semibold" data-testid="text-page-heading">
              {investmentName || "Edit Investment"}
            </h4>
          </div>
        </div>

        {/* Stepper UI */}
        <Card className="rounded-b-none rounded-t-xl">
          <CardContent className="p-0">
            <div className="border-b border-b-transparent">
              <nav className="flex" data-testid="step-nav">
                {STEPS.map((step, idx) => {
                  const isActive = idx === currentStep;
                  const isDone = idx < currentStep;
                  const isUpdatesStep = step.id === 5;
                  const isDisabled = isUpdatesStep && updatesDisabled;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={isDisabled}
                      title={isDisabled ? "Updates are not available for investments that are Closed - Not Invested." : undefined}
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors relative
                        ${isActive ? "text-[#405189] bg-[#405189]/5" : isDone ? "text-[#0ab39c]" : "text-muted-foreground"}
                        ${idx > 0 ? "border-l" : ""}
                        ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}
                      `}
                      onClick={() => { if (!isDisabled) setCurrentStep(idx); }}
                      data-testid={`step-tab-${idx}`}
                    >
                      <div
                        className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold shrink-0
                        ${isActive ? "bg-[#405189] text-white" : isDone ? "bg-[#0ab39c] text-white" : "bg-muted text-muted-foreground"}
                      `}
                      >
                        {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                      </div>
                      <span className="hidden sm:inline">{step.label}</span>
                      {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#405189]" />}
                    </button>
                  );
                })}
              </nav>
            </div>
          </CardContent>
        </Card>

        {/* ── STEP 0: ABOUT YOU ── */}
        {currentStep === 0 && (
          <Card className="rounded-t-none rounded-b-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">About You</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5" ref={fullNameRef}>
                    <Label htmlFor="contactInfoFullName" className="text-sm">
                      Investment Owner Name
                    </Label>
                    <Input id="contactInfoFullName" value={formData.contactInfoFullName} onChange={(e) => upd("contactInfoFullName", e.target.value)} placeholder="Contact Full Name" className={fe("contactInfoFullName")} data-testid="input-full-name" />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="investmentInfoEmail" className="text-sm">Investment Informational email</Label>
                    <Input id="investmentInfoEmail" type="email" value={formData.investmentInfoEmail} onChange={(e) => upd("investmentInfoEmail", e.target.value)} placeholder="Investment informational email" data-testid="input-info-email" />
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Investment Update Recipients</Label>
                      <p className="text-xs text-muted-foreground">
                        These people will be emailed each time someone invests in this campaign. If left empty, the Investment Informational email above is used.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        upd("investmentNotificationRecipients", [
                          ...(formData.investmentNotificationRecipients || []),
                          { name: "", email: "" },
                        ])
                      }
                      data-testid="button-add-notification-recipient"
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {(formData.investmentNotificationRecipients || []).map((row, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-start">
                        <Input
                          value={row.name}
                          onChange={(e) => {
                            const next = [...(formData.investmentNotificationRecipients || [])];
                            next[idx] = { ...next[idx], name: e.target.value };
                            upd("investmentNotificationRecipients", next);
                          }}
                          placeholder="Name (optional)"
                          data-testid={`input-notif-name-${idx}`}
                        />
                        <Input
                          type="email"
                          value={row.email}
                          onChange={(e) => {
                            const next = [...(formData.investmentNotificationRecipients || [])];
                            next[idx] = { ...next[idx], email: e.target.value };
                            upd("investmentNotificationRecipients", next);
                          }}
                          placeholder="email@example.com"
                          data-testid={`input-notif-email-${idx}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const list = formData.investmentNotificationRecipients || [];
                            const next = list.filter((_, i) => i !== idx);
                            upd(
                              "investmentNotificationRecipients",
                              next.length > 0 ? next : [{ name: "", email: "" }],
                            );
                          }}
                          aria-label="Remove recipient"
                          data-testid={`button-remove-notif-${idx}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contactInfoPhoneNumber" className="text-sm">Mobile Number</Label>
                  <Input
                    id="contactInfoPhoneNumber"
                    type="tel"
                    value={formData.contactInfoPhoneNumber}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      upd("contactInfoPhoneNumber", val);
                    }}
                    maxLength={10}
                    data-testid="input-phone"
                  />
                </div>

                <div className="space-y-1.5 flex flex-col">
                  <Label className="text-sm">Where is your company or fund legally registered (domiciled)?</Label>
                  <p className="text-xs text-muted-foreground">
                    Please indicate the country where your investment vehicle is legally registered or domiciled. Note: Contributions on CataCap are tax-deductible for U.S. donor-investors only. While we are able to work with companies and funds registered outside the U.S. in many cases, the most successful campaigns typically have a strong U.S. donor-investor network.
                  </p>
                  <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={countryOpen}
                        className={cn(
                          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                          !formData.country && "text-muted-foreground"
                        )}
                        data-testid="select-country"
                      >
                        <span className="truncate">
                          {formData.country ? countries.find((c) => c.name === formData.country)?.name || formData.country : "Select country"}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[300px] bg-popover" align="start">
                      <Command className="bg-transparent">
                        <CommandInput placeholder="Search country..." />
                        <CommandList className="max-h-60">
                          <CommandEmpty>No country found.</CommandEmpty>
                          <CommandGroup>
                            {countries.length > 0 ? (
                              countries.map((c) => (
                                <CommandItem
                                  key={c.id || c.name}
                                  value={c.name}
                                  onSelect={(curr) => {
                                    upd("country", curr);
                                    upd("address1", ""); upd("address2", ""); upd("city", ""); upd("state", ""); upd("zipCode", "");
                                    setCountryOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", formData.country === c.name ? "opacity-100" : "opacity-0")} />
                                  {c.name}
                                </CommandItem>
                              ))
                            ) : (
                              ["USA", "Canada", "United Kingdom"].map((c) => (
                                <CommandItem
                                  key={c}
                                  value={c}
                                  onSelect={(curr) => {
                                    upd("country", curr);
                                    upd("address1", ""); upd("address2", ""); upd("city", ""); upd("state", ""); upd("zipCode", "");
                                    setCountryOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", formData.country === c ? "opacity-100" : "opacity-0")} />
                                  {c}
                                </CommandItem>
                              ))
                            )}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {formData.country && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="address1" className="text-sm">Address Line 1</Label>
                        <Input id="address1" value={formData.address1} onChange={(e) => upd("address1", e.target.value)} placeholder="Street address" data-testid="input-address1" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="address2" className="text-sm">Address Line 2</Label>
                        <Input id="address2" value={formData.address2} onChange={(e) => upd("address2", e.target.value)} placeholder="Apt, suite, etc." data-testid="input-address2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="city" className="text-sm">City</Label>
                        <Input id="city" value={formData.city} onChange={(e) => upd("city", e.target.value)} placeholder="City" data-testid="input-city" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="state" className="text-sm">State / Province / Region</Label>
                        {(formData.country === "USA" || formData.country === "United States") ? (
                          <Select value={formData.state} onValueChange={(val) => upd("state", val)}>
                            <SelectTrigger data-testid="select-state"><SelectValue placeholder="Select state" /></SelectTrigger>
                            <SelectContent className="max-h-60">
                              {US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input id="state" value={formData.state} onChange={(e) => upd("state", e.target.value)} placeholder="State / Province / Region" data-testid="input-state" />
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="zipCode" className="text-sm">Zip / Postal Code</Label>
                        <Input id="zipCode" value={formData.zipCode} onChange={(e) => upd("zipCode", e.target.value)} placeholder="Zip / Postal Code" data-testid="input-zip" />
                      </div>
                    </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="networkDescription" className="text-sm">
                    Tell us a bit about your network — how many potential investors or supporters you can reach (e.g., social media presence, email list size, past backers), as well as any key champions in your corner.
                  </Label>
                  <Textarea id="networkDescription" value={formData.networkDescription} onChange={(e) => upd("networkDescription", e.target.value)} placeholder="e.g., 5,000 followers on LinkedIn, 2,000 email subscribers" rows={3} data-testid="input-network" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Have you received funding from Impact Assets before?</Label>
                    <Select value={formData.impactAssetsFundingStatus || "No"} defaultValue="No" onValueChange={(val) => upd("impactAssetsFundingStatus", val)}>
                      <SelectTrigger data-testid="select-funding-status"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="Not sure">Not sure</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5" ref={corporateBankAccountRef}>
                    <Label className="text-sm">Does your company have a corporate bank account set up?</Label>
                    <Select value={formData.hasCorporateBankAccount} onValueChange={(val) => upd("hasCorporateBankAccount", val)}>
                      <SelectTrigger data-testid="select-corporate-bank-account"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2" ref={personalFinancialBenefitRef}>
                    <Label className="text-sm">Does any board member, officer, or related party stand to receive personal financial benefit from this investment?</Label>
                    <Select value={formData.hasPersonalFinancialBenefit} onValueChange={(val) => upd("hasPersonalFinancialBenefit", val)}>
                      <SelectTrigger data-testid="select-personal-financial-benefit"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.hasPersonalFinancialBenefit === "Yes" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="personalFinancialBenefitDescription" className="text-sm">Please describe</Label>
                      <Textarea id="personalFinancialBenefitDescription" value={formData.personalFinancialBenefitDescription} onChange={(e) => upd("personalFinancialBenefitDescription", e.target.value)} rows={3} data-testid="input-personal-financial-benefit-description" />
                    </div>
                  )}

                  <div className="space-y-1.5 sm:col-span-2" ref={regulatoryIssuesRef}>
                    <Label className="text-sm">Has the organization or any of its officers ever been subject to regulatory action, criminal investigation, or sanctions?</Label>
                    <Select value={formData.hasRegulatoryIssues} onValueChange={(val) => upd("hasRegulatoryIssues", val)}>
                      <SelectTrigger data-testid="select-regulatory-issues"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.hasRegulatoryIssues === "Yes" && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="regulatoryIssuesDescription" className="text-sm">Please describe</Label>
                      <Textarea id="regulatoryIssuesDescription" value={formData.regulatoryIssuesDescription} onChange={(e) => upd("regulatoryIssuesDescription", e.target.value)} rows={3} data-testid="input-regulatory-issues-description" />
                    </div>
                  )}

                  <div className="space-y-1.5" ref={goodLegalStandingRef}>
                    <Label className="text-sm">Is the organization currently in good legal standing with all relevant regulatory bodies?</Label>
                    <Select value={formData.isInGoodLegalStanding} onValueChange={(val) => upd("isInGoodLegalStanding", val)}>
                      <SelectTrigger data-testid="select-good-legal-standing"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">Your role with the investment</Label>
                    <Select value={formData.investmentRole} onValueChange={(val) => upd("investmentRole", val)}>
                      <SelectTrigger data-testid="select-role"><SelectValue placeholder="Select your role" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Company/Fund Executive">Company/Fund Executive</SelectItem>
                        <SelectItem value="Investor">Investor</SelectItem>
                        <SelectItem value="Founder / Co-Founder">Founder / Co-Founder</SelectItem>
                        <SelectItem value="CEO / Executive Director">CEO / Executive Director</SelectItem>
                        <SelectItem value="CFO / Finance Lead">CFO / Finance Lead</SelectItem>
                        <SelectItem value="Fundraiser / Development">Fundraiser / Development</SelectItem>
                        <SelectItem value="Advisor / Consultant">Advisor / Consultant</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="referredToCataCap" className="text-sm">How were you referred to CataCap?</Label>
                  <Input id="referredToCataCap" value={formData.referredToCataCap} onChange={(e) => upd("referredToCataCap", e.target.value)} placeholder="e.g., Search Engine, LinkedIn, Friend" data-testid="input-referred" />
                </div>

              </CardContent>
            </Card>
        )}

        {/* ── STEP 1: ABOUT THE INVESTMENT ── */}
        {currentStep === 1 && (
          <Card className="rounded-t-none rounded-b-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">About the Investment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5" ref={nameRef}>
                    <Label htmlFor="name" className="text-sm">Investment Name</Label>
                    <Input id="name" value={formData.name} onChange={(e) => upd("name", e.target.value)} placeholder="Investment name" className={fe("name")} data-testid="input-investment-name" />
                    {errors.name && <p className="text-[#f06548] text-xs">Investment name is required.</p>}
                  </div>

                  <div className="space-y-1.5" ref={websiteRef}>
                    <Label htmlFor="website" className="text-sm">Investment website URL</Label>
                    <Input id="website" type="url" value={formData.website} onChange={(e) => upd("website", e.target.value)} placeholder="https://example.com" className={fe("website")} data-testid="input-website" />
                    {errors.website && <p className="text-[#f06548] text-xs">Investment website URL is required.</p>}
                  </div>
                </div>

                <div className="space-y-1.5" ref={targetRef}>
                  <Label htmlFor="target" className="text-sm">CataCap Fundraising Goal ($US)</Label>
                  <p className="text-xs text-muted-foreground">How much do you want to raise through your CataCap campaign?</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input id="target" type="number" min={1} value={formData.target} onChange={(e) => upd("target", e.target.value.replace(/[^0-9]/g, ""))} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault(); }} placeholder="e.g., 500000" className={`pl-7 ${fe("target")}`} data-testid="input-fundraising-goal" />
                  </div>
                  {errors.target && <p className="text-[#f06548] text-xs">Fundraising goal is required.</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="missionVision" className="text-sm">Mission/Vision (Not to exceed 1,000 characters)</Label>
                  <Textarea id="missionVision" value={formData.missionVision} onChange={(e) => upd("missionVision", e.target.value)} placeholder="Mission/Vision" rows={5} maxLength={1000} data-testid="input-mission" />
                  <p className="text-xs text-muted-foreground">Which type of personalized quote, to convey the mission and vision of your investment, would you like to share?</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Expected Fundraising Close Date? <span className="text-[#f06548]">*</span></Label>
                    <div className="flex items-center gap-2 mb-2">
                      <Checkbox id="isEvergreen" checked={formData.isEvergreen} onCheckedChange={(checked) => { upd("isEvergreen", !!checked); if (checked) upd("fundraisingCloseDate", ""); }} data-testid="checkbox-evergreen" />
                      <Label htmlFor="isEvergreen" className="text-sm font-normal cursor-pointer">Evergreen</Label>
                    </div>
                    {!formData.isEvergreen && (
                      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("w-full sm:w-72 justify-start text-left font-normal", !formData.fundraisingCloseDate && "text-muted-foreground")} data-testid="button-calendar">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formData.fundraisingCloseDate ? formatDate(formData.fundraisingCloseDate, "") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={formData.fundraisingCloseDate && dayjs(formData.fundraisingCloseDate).isAfter(dayjs(), "day") ? new Date(formData.fundraisingCloseDate) : undefined}
                            onSelect={(date) => { upd("fundraisingCloseDate", date ? formatDateISO(date) : ""); setCalendarOpen(false); }}
                            disabled={(date) => dayjs(date).isBefore(dayjs().add(1, "day"), "day")}
                            modifiers={{ today: [] }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="expectedTotal" className="text-sm">How much money do you have soft-circled for your CataCap campaign?</Label>
                    <p className="text-xs text-muted-foreground">Companies and funds must have at least $25,000 in pre-commitments lined up from donor-investors prior to going live on CataCap.</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input id="expectedTotal" type="number" min={0} value={formData.expectedTotal} onChange={(e) => upd("expectedTotal", e.target.value.replace(/[^0-9]/g, ""))} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault(); }} placeholder="e.g., 300" className="pl-7" data-testid="input-expected-total" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label htmlFor="personalizedThankYou" className="text-sm">Personalized Thank You</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openPreviewEmail}
                      data-testid="button-preview-thank-you-email"
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Preview email
                    </Button>
                  </div>
                  <RichTextEditor
                    value={formData.personalizedThankYou}
                    onChange={(html) => upd("personalizedThankYou", html)}
                    placeholder="Personalized Thank You"
                    data-testid="input-thank-you"
                  />
                  <div className="text-xs text-muted-foreground">
                    <span>What would you like your customized thank you message — displayed to users following a donation to your investment — to say?</span>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label className="text-sm">Attachments</Label>
                      <span className="text-xs text-muted-foreground" data-testid="text-thank-you-total-size">
                        {formatBytes(thankYouUsedBytes)} of {formatBytes(THANK_YOU_TOTAL_MAX_BYTES)} used
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Allowed: PDF, DOC, DOCX, PNG, JPG, WEBP. Max 10 MB per file, 25 MB total.
                    </p>

                    <div
                      className={cn(
                        "rounded-md border-2 border-dashed p-4 transition-colors text-center",
                        thankYouDragActive ? "border-[#405189] bg-[#f3f6ff]" : "border-muted-foreground/30 bg-muted/20"
                      )}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setThankYouDragActive(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setThankYouDragActive(false);
                      }}
                      onDrop={handleThankYouDrop}
                      data-testid="thank-you-dropzone"
                    >
                      <p className="text-sm text-muted-foreground">
                        Drag and drop files here, or
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => thankYouFileInputRef.current?.click()}
                        data-testid="button-add-thank-you-attachment"
                      >
                        Choose files
                      </Button>
                      <input
                        ref={thankYouFileInputRef}
                        type="file"
                        multiple
                        accept={THANK_YOU_ACCEPT_ATTR}
                        className="hidden"
                        onChange={handleThankYouFileInputChange}
                        data-testid="input-thank-you-attachment-file"
                      />
                    </div>

                    {thankYouAttachmentError && (
                      <p className="text-xs text-[#f06548]" data-testid="text-thank-you-attachment-error">
                        {thankYouAttachmentError}
                      </p>
                    )}

                    {(thankYouExistingAttachments.length > 0 || thankYouPendingFiles.length > 0) && (
                      <ul className="divide-y rounded-md border">
                        {thankYouExistingAttachments.map((att) => {
                          const removed = thankYouRemovedIds.includes(att.id);
                          return (
                            <li
                              key={`existing-${att.id}`}
                              className={cn(
                                "flex items-center justify-between gap-3 px-3 py-2",
                                removed && "opacity-60"
                              )}
                              data-testid={`item-thank-you-attachment-${att.id}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0">
                                  {att.publicUrl ? (
                                    <a
                                      href={att.publicUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn("text-sm truncate block", removed ? "line-through" : "text-[#405189] hover:underline")}
                                      data-testid={`link-thank-you-attachment-${att.id}`}
                                    >
                                      {att.fileName}
                                    </a>
                                  ) : (
                                    <span className={cn("text-sm truncate block", removed && "line-through")}>{att.fileName}</span>
                                  )}
                                  <span className="text-xs text-muted-foreground">{formatBytes(att.sizeBytes)}{removed ? " · will be removed on save" : ""}</span>
                                </div>
                              </div>
                              {removed ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => undoRemoveExistingThankYouAttachment(att.id)}
                                  data-testid={`button-undo-remove-thank-you-attachment-${att.id}`}
                                >
                                  Undo
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeExistingThankYouAttachment(att.id)}
                                  data-testid={`button-remove-thank-you-attachment-${att.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </li>
                          );
                        })}
                        {thankYouPendingFiles.map((f) => (
                          <li
                            key={`pending-${f.localId}`}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-[#f6fbf7]"
                            data-testid={`item-thank-you-attachment-pending-${f.localId}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <span className="text-sm truncate block">{f.fileName}</span>
                                <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)} · will be uploaded on save</span>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removePendingThankYouAttachment(f.localId)}
                              data-testid={`button-remove-thank-you-attachment-pending-${f.localId}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="metaTitle" className="text-sm">Meta Title</Label>
                    <Input
                      id="metaTitle"
                      value={formData.metaTitle}
                      onChange={(e) => upd("metaTitle", e.target.value)}
                      placeholder="Enter meta title"
                      data-testid="input-meta-title"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="metaDescription" className="text-sm">Meta Description</Label>
                    <Textarea
                      id="metaDescription"
                      value={formData.metaDescription}
                      onChange={(e) => upd("metaDescription", e.target.value)}
                      placeholder="Enter meta description"
                      rows={2}
                      data-testid="input-meta-description"
                    />
                  </div>
                </div>

                {themes.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm">Investment Themes Covered (Select all that apply)</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="themes-list">
                      {themes.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <Checkbox id={`theme-${t.id}`} checked={formData.themeIds.includes(t.id)} onCheckedChange={() => toggleId("themeIds", t.id)} data-testid={`checkbox-theme-${t.id}`} />
                          <Label htmlFor={`theme-${t.id}`} className="text-sm font-normal cursor-pointer">{t.name}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {sdgs.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm">SDGs Impacted by Investment (Select all that apply)</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="sdgs-list">
                      {sdgs.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <Checkbox id={`sdg-${s.id}`} checked={formData.sdgIds.includes(s.id)} onCheckedChange={() => toggleId("sdgIds", s.id)} data-testid={`checkbox-sdg-${s.id}`} />
                          <Label htmlFor={`sdg-${s.id}`} className="text-sm font-normal cursor-pointer">{s.id}. {s.name}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
        )}


        {/* ── STEP 2: MEDIA ── */}
        {currentStep === 2 && (
          <Card className="rounded-t-none rounded-b-xl">
            <CardContent className="p-6 space-y-6">
              {/* ── Image Uploads ── */}
              <div className="space-y-6">
                {/* Logo */}
                <div className="grid grid-cols-12 gap-y-2">
                  <div className="col-span-12">
                    <p style={inputHeaderLabelStyle}>
                      Company / Investment Logo (max file size 10 MB) {!isAdmin && <span style={{ color: "red" }}> *</span>}
                    </p>
                  </div>
                  <div className="col-span-12" ref={logoRef}>
                    <div className="w-full">
                      <label htmlFor="upload-logo-input" className="cursor-pointer">
                        <div className="flex flex-col items-center justify-around p-2 border border-[#ccc] rounded-[4px] min-h-[140px] hover:border-[#405189]/50 transition-colors bg-muted/30">
                          <input
                            id="upload-logo-input"
                            hidden
                            onChange={uploadLogoChange}
                            accept=".png, .gif, .jpg"
                            type="file"
                          />
                          <div className="flex flex-col items-center">
                            {logo || logoFileName ? (
                              <div className="flex flex-col items-center">
                                <img
                                  src={logo || getUrlBlobContainerImage(logoFileName)}
                                  alt="Logo"
                                  className="w-[100px] h-[100px] rounded object-contain"
                                  onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                                />
                              </div>
                            ) : (
                              <>
                                <svg
                                  viewBox="0 0 1024 1024"
                                  focusable="false"
                                  width="30px"
                                  height="30px"
                                  fill="#000000C3"
                                  aria-hidden="true"
                                >
                                  <path d="M885.2 446.3l-.2-.8-112.2-285.1c-5-16.1-19.9-27.2-36.8-27.2H281.2c-17 0-32.1 11.3-36.9 27.6L139.4 443l-.3.7-.2.8c-1.3 4.9-1.7 9.9-1 14.8-.1 1.6-.2 3.2-.2 4.8V830a60.9 60.9 0 0 0 60.8 60.8h627.2c33.5 0 60.8-27.3 60.9-60.8V464.1c0-1.3 0-2.6-.1-3.7.4-4.9 0-9.6-1.3-14.1zm-295.8-43l-.3 15.7c-.8 44.9-31.8 75.1-77.1 75.1-22.1 0-41.1-7.1-54.8-20.6S436 441.2 435.6 419l-.3-15.7H229.5L309 210h399.2l81.7 193.3H589.4zm-375 76.8h157.3c24.3 57.1 76 90.8 140.4 90.8 33.7 0 65-9.4 90.3-27.2 22.2-15.6 39.5-37.4 50.7-63.6h156.5V814H214.4V480.1z"></path>
                                </svg>
                                <p style={uploadTextStyle} className="text-center mt-2">
                                  Click to Upload File.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                      <p style={{ ...inputLabelStyle, fontSize: "14px" }}>
                        This image used when your link is shared. For best display results, please provide a .png, .gif, or .jpg logo with at least 600 ppi (pixels per inch) resolution.
                      </p>
                      {fileErrors.logo && <p style={errorTextStyle}>{fileErrors.logo}</p>}
                      {errors.logo && <p style={errorTextStyle}>Only image files are allowed</p>}
                    </div>
                  </div>
                </div>

                {/* Profile Image */}
                <div className="grid grid-cols-12 gap-y-2">
                  <div className="col-span-12 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
                    <p style={inputHeaderLabelStyle} className="!mb-0">
                      Company / Investment Profile Image (max file size 10 MB) {!isAdmin && <span style={{ color: "red" }}> *</span>}
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="crop-profile-toggle"
                        checked={cropProfileEnabled}
                        onCheckedChange={setCropProfileEnabled}
                        data-testid="switch-crop-profile"
                      />
                      <Label htmlFor="crop-profile-toggle" className="text-sm font-medium cursor-pointer">
                        Crop image after upload
                      </Label>
                    </div>
                  </div>
                  <div className="col-span-12" ref={imageRef}>
                    <div className="w-full">
                      <label htmlFor="upload-profile-input" className="cursor-pointer">
                        <div className="flex flex-col items-center justify-around p-2 border border-[#ccc] rounded-[4px] min-h-[140px] hover:border-[#405189]/50 transition-colors bg-muted/30">
                          <input
                            id="upload-profile-input"
                            hidden
                            onChange={uploadImageChange}
                            accept=".png, .gif, .jpg"
                            type="file"
                          />
                          <div className="flex flex-col items-center">
                            {image || imageFileName ? (
                              <div className="flex flex-col items-center">
                                <img
                                  src={image || getUrlBlobContainerImage(imageFileName)}
                                  alt="Profile"
                                  className="w-[100px] h-[100px] rounded object-contain"
                                  onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                                />
                              </div>
                            ) : (
                              <>
                                <svg
                                  viewBox="0 0 1024 1024"
                                  focusable="false"
                                  width="30px"
                                  height="30px"
                                  fill="#000000C3"
                                  aria-hidden="true"
                                >
                                  <path d="M885.2 446.3l-.2-.8-112.2-285.1c-5-16.1-19.9-27.2-36.8-27.2H281.2c-17 0-32.1 11.3-36.9 27.6L139.4 443l-.3.7-.2.8c-1.3 4.9-1.7 9.9-1 14.8-.1 1.6-.2 3.2-.2 4.8V830a60.9 60.9 0 0 0 60.8 60.8h627.2c33.5 0 60.8-27.3 60.9-60.8V464.1c0-1.3 0-2.6-.1-3.7.4-4.9 0-9.6-1.3-14.1zm-295.8-43l-.3 15.7c-.8 44.9-31.8 75.1-77.1 75.1-22.1 0-41.1-7.1-54.8-20.6S436 441.2 435.6 419l-.3-15.7H229.5L309 210h399.2l81.7 193.3H589.4zm-375 76.8h157.3c24.3 57.1 76 90.8 140.4 90.8 33.7 0 65-9.4 90.3-27.2 22.2-15.6 39.5-37.4 50.7-63.6h156.5V814H214.4V480.1z"></path>
                                </svg>
                                <p style={uploadTextStyle} className="text-center mt-2">
                                  Click to Upload File.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                      <p style={{ ...inputLabelStyle, fontSize: "14px" }}>
                        This image appears on your investment page (e.g.,{" "}
                        <a
                          href="https://catacap.org/investments/empowerherfund"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline break-all"
                          style={{ color: "#0000008C" }}
                        >
                          https://catacap.org/investments/empowerherfund
                        </a>
                        ). For best display results, please provide a .png, .gif, or .jpg logo file with at least 600 ppi (pixels per inch) resolution. We also see that Investments have the best results with a 763 × 400 pixel ratio.
                      </p>
                      {fileErrors.profile && <p style={errorTextStyle}>{fileErrors.profile}</p>}
                      {errors.image && <p style={errorTextStyle}>Only image files are allowed</p>}
                    </div>
                  </div>
                </div>

                {/* Smaller Image */}
                <div className="grid grid-cols-12 gap-y-2">
                  <div className="col-span-12 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
                    <p style={inputHeaderLabelStyle} className="!mb-0">
                      Company / Investment Smaller Image (max file size 10 MB) {!isAdmin && <span style={{ color: "red" }}> *</span>}
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="crop-tile-toggle"
                        checked={cropTileEnabled}
                        onCheckedChange={setCropTileEnabled}
                        data-testid="switch-crop-tile"
                      />
                      <Label htmlFor="crop-tile-toggle" className="text-sm font-medium cursor-pointer">
                        Crop image after upload
                      </Label>
                    </div>
                  </div>
                  <div className="col-span-12" ref={tileImageRef}>
                    <div className="w-full">
                      <label htmlFor="upload-smaller-input" className="cursor-pointer">
                        <div className="flex flex-col items-center justify-around p-2 border border-[#ccc] rounded-[4px] min-h-[140px] hover:border-[#405189]/50 transition-colors bg-muted/30">
                          <input
                            id="upload-smaller-input"
                            hidden
                            onChange={uploadTileImageChange}
                            accept=".png, .gif, .jpg"
                            type="file"
                          />
                          <div className="flex flex-col items-center">
                            {tileImage || tileImageFileName ? (
                              <div className="flex flex-col items-center">
                                <img
                                  src={tileImage || getUrlBlobContainerImage(tileImageFileName)}
                                  alt="Smaller"
                                  className="w-[100px] h-[100px] rounded object-contain"
                                  onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                                />
                              </div>
                            ) : (
                              <>
                                <svg
                                  viewBox="0 0 1024 1024"
                                  focusable="false"
                                  width="30px"
                                  height="30px"
                                  fill="#000000C3"
                                  aria-hidden="true"
                                >
                                  <path d="M885.2 446.3l-.2-.8-112.2-285.1c-5-16.1-19.9-27.2-36.8-27.2H281.2c-17 0-32.1 11.3-36.9 27.6L139.4 443l-.3.7-.2.8c-1.3 4.9-1.7 9.9-1 14.8-.1 1.6-.2 3.2-.2 4.8V830a60.9 60.9 0 0 0 60.8 60.8h627.2c33.5 0 60.8-27.3 60.9-60.8V464.1c0-1.3 0-2.6-.1-3.7.4-4.9 0-9.6-1.3-14.1zm-295.8-43l-.3 15.7c-.8 44.9-31.8 75.1-77.1 75.1-22.1 0-41.1-7.1-54.8-20.6S436 441.2 435.6 419l-.3-15.7H229.5L309 210h399.2l81.7 193.3H589.4zm-375 76.8h157.3c24.3 57.1 76 90.8 140.4 90.8 33.7 0 65-9.4 90.3-27.2 22.2-15.6 39.5-37.4 50.7-63.6h156.5V814H214.4V480.1z"></path>
                                </svg>
                                <p style={uploadTextStyle} className="text-center mt-2">
                                  Click to Upload File.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                      <p style={{ ...inputLabelStyle, fontSize: "14px" }}>
                        This image appears on{" "}
                        <a
                          href="https://catacap.org/investments"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                          style={{ color: "#0000008C" }}
                        >
                          https://catacap.org/investments
                        </a>
                        . For best display results, please provide a .png, .gif, or .jpg logo file with at least 600 ppi (pixels per inch) resolution. We also see that Investments have the best results with a 362 × 250 pixel ratio.
                      </p>
                      {fileErrors.tile && <p style={errorTextStyle}>{fileErrors.tile}</p>}
                      {errors.tileImage && <p style={errorTextStyle}>Only image files are allowed</p>}
                    </div>
                  </div>
                </div>

                {/* Pitch Deck */}
                <div className="grid grid-cols-12 gap-y-2">
                  <div className="col-span-12">
                    <p style={inputHeaderLabelStyle}>
                      Company / Investment Pitch Deck (max file size 20 MB) <span style={{ color: "red" }}> *</span>
                    </p>
                  </div>
                  <div className="col-span-12" ref={pitchDeckRef}>
                    <div className="w-full">
                      <label htmlFor="upload-pdf-input" className="cursor-pointer">
                        <div className="flex flex-col items-center justify-around p-2 border border-[#ccc] rounded-[4px] min-h-[140px] hover:border-[#405189]/50 transition-colors bg-muted/30">
                          <input
                            id="upload-pdf-input"
                            hidden
                            onChange={handlePdfChange}
                            accept=".pdf"
                            type="file"
                          />
                          <div className="flex flex-col items-center">
                            {pitchDeckFile ? (
                              <div className="flex flex-col items-center gap-2">
                                <span className="text-[#0ab39c] font-medium text-center break-all px-4">{pitchDeckFile.name}</span>
                                <p className="text-xs text-muted-foreground">(Newly selected file)</p>
                              </div>
                            ) : originalPdfFileName ? (
                              <div className="flex flex-col items-center gap-3">
                                <span className="text-[#0ab39c] font-medium text-center break-all px-4">{originalPdfFileName}</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-[#0ab39c] text-[#0ab39c] hover:bg-[#0ab39c]/10 gap-2"
                                  onClick={handleDownloadPdf}
                                  disabled={isDownloadingPdf}
                                  data-testid="button-download-pitch-deck"
                                >
                                  <Download className={cn("h-4 w-4", isDownloadingPdf && "animate-pulse")} />
                                  {isDownloadingPdf ? "Downloading..." : "Download Current Pitch Deck"}
                                </Button>
                              </div>
                            ) : pdfFileName ? (
                              <div className="flex flex-col items-center gap-3">
                                <span className="text-[#0ab39c] font-medium text-center break-all px-4">{(() => { try { const decoded = decodeURIComponent(pdfFileName); const parts = decoded.split('/'); return parts[parts.length - 1] || pdfFileName; } catch { return pdfFileName; } })()}</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-[#0ab39c] text-[#0ab39c] hover:bg-[#0ab39c]/10 gap-2"
                                  onClick={handleDownloadPdf}
                                  disabled={isDownloadingPdf}
                                  data-testid="button-download-pitch-deck"
                                >
                                  <Download className={cn("h-4 w-4", isDownloadingPdf && "animate-pulse")} />
                                  {isDownloadingPdf ? "Downloading..." : "Download Current Pitch Deck"}
                                </Button>
                              </div>
                            ) : (
                              <>
                                <svg
                                  viewBox="0 0 1024 1024"
                                  focusable="false"
                                  width="30px"
                                  height="30px"
                                  fill="#000000C3"
                                  aria-hidden="true"
                                >
                                  <path d="M885.2 446.3l-.2-.8-112.2-285.1c-5-16.1-19.9-27.2-36.8-27.2H281.2c-17 0-32.1 11.3-36.9 27.6L139.4 443l-.3.7-.2.8c-1.3 4.9-1.7 9.9-1 14.8-.1 1.6-.2 3.2-.2 4.8V830a60.9 60.9 0 0 0 60.8 60.8h627.2c33.5 0 60.8-27.3 60.9-60.8V464.1c0-1.3 0-2.6-.1-3.7.4-4.9 0-9.6-1.3-14.1zm-295.8-43l-.3 15.7c-.8 44.9-31.8 75.1-77.1 75.1-22.1 0-41.1-7.1-54.8-20.6S436 441.2 435.6 419l-.3-15.7H229.5L309 210h399.2l81.7 193.3H589.4zm-375 76.8h157.3c24.3 57.1 76 90.8 140.4 90.8 33.7 0 65-9.4 90.3-27.2 22.2-15.6 39.5-37.4 50.7-63.6h156.5V814H214.4V480.1z"></path>
                                </svg>
                                <p style={uploadTextStyle} className="text-center mt-2">
                                  Click to upload file.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </label>
                      <p style={{ ...inputLabelStyle, fontSize: "14px" }}>
                        This file is the pdf presentation of your company or investment. For best display results, please provide a file with a .pdf extension and less than 20 MB.
                      </p>
                      {fileErrors.pdf && <p style={errorTextStyle}>{fileErrors.pdf}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 3: ADMIN SETTINGS ── */}
        {currentStep === 3 && (
          <Card className="rounded-t-none rounded-b-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">CataCap Admin</CardTitle>
                {/* Investment Recommendations */}
                <div className="mt-4 p-4 rounded-md border bg-muted/20 flex items-center justify-between">
                  <p className="text-sm font-medium">Investment Recommendations</p>
                  <Button
                    className="bg-[#405189] hover:bg-[#364574] text-white"
                    data-testid="button-export-donations"
                    onClick={async () => {
                      try {
                        await exportInvestmentRecommendations(formData.id!, investmentName || "investment");
                        toast({ title: "Export Complete", description: "Recommendations exported successfully." });
                      } catch (err: any) {
                        const msg = err?.message || "Could not export recommendations. Please try again.";
                        toast({ title: "Export", description: msg });
                      }
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Donations to Invest to Date
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Investment Owner — must match an existing user */}
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm">Investment Owner</Label>
                    <UserEmailCombobox
                      value={formData.email}
                      onChange={(email) => upd("email", email)}
                      onValidityChange={setInvestmentOwnerValid}
                      placeholder="Search investment owner by email..."
                      testId="combobox-investment-owner"
                    />
                  </div>

                  {/* Investment Instruments — multi-select dropdown */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Investment Instruments (Select all that apply)</Label>
                    <MultiSelectPopover
                      options={investmentTypes}
                      selected={formData.investmentTypeIds}
                      onToggle={(id) => toggleId("investmentTypeIds", id)}
                      placeholder="Select Investment Instruments"
                      testId="multiselect-investment-type"
                    />
                  </div>
                </div>

                {/* About the Investment */}
                <div className="space-y-1.5">
                  <Label className="text-sm">About the Investment (Not to exceed 3,000 characters)</Label>
                  <p className="text-xs text-muted-foreground">
                    This section will appear on your campaign page. Please provide a high-level overview of your company or fund, the progress you've made, and the impact you're driving. Use this section to help donor-investors understand why your work matters and how their support can accelerate your next stage of growth.
                  </p>
                  <RichTextEditor value={formData.description} onChange={(val) => upd("description", val)} placeholder="Investment Description" data-testid="input-description" maxLength={3000} />
                  <p className="text-xs text-muted-foreground text-right">{formData.description.replace(/<[^>]*>/g, "").length} / 3,000 characters</p>
                </div>

                {/* Investment Terms */}
                <div className="space-y-1.5">
                  <Label className="text-sm">Investment Terms (provide 3-10 bullet points of key terms)</Label>
                  <p className="text-xs text-muted-foreground">
                    Please summarize your investment terms for potential donor-investors. Consider including expected valuation cap (specify if pre- or post-money), any discounts offered, timeline / return expectations, etc.
                  </p>
                  <RichTextEditor value={formData.terms} onChange={(val) => upd("terms", val)} placeholder="Investment Terms" suggestions={staticTerms} data-testid="input-terms" maxLength={2000} />
                </div>

                {/* NOTE block */}
                <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-2">
                  <p>
                    <span className="font-bold text-foreground">NOTE:</span> All investments will also display the following text. And, if your terms require customization, the CataCap Team will collaborate with you.
                  </p>
                  <p>
                    CataCap pools donor commitments and deploys them into the related company or fund once the required $50,000 minimum is reached. If the minimum is not met, your commitment will be available in your CataCap account for reallocation or can be transferred as{" "}
                    <a href="https://www.catacap.org/terms-conditions/" target="_blank" rel="noopener noreferrer" className="underline text-[#405189]">outlined</a>{" "}
                    (see Transfers). Funds cannot be returned to a private foundation or personal account once a tax-deductible contribution is made. The terms above are the official terms of the underlying company or fund; they apply to CataCap as the investing entity and are provided for informational purposes.
                  </p>
                </div>

                {/* Minimum Investment */}
                <div className="space-y-1.5" ref={minInvestRef}>
                  <Label htmlFor="minimumInvestment" className="text-sm">Minimum Investment <span className="text-[#f06548]">*</span></Label>
                  <Input id="minimumInvestment" type="number" min={0} value={formData.minimumInvestment} onChange={(e) => upd("minimumInvestment", e.target.value.replace(/[^0-9.]/g, ""))} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault(); }} placeholder="Enter minimum investment" className={fe("minimumInvestment")} data-testid="input-min-investment" />
                  {errors.minimumInvestment && <p className="text-[#f06548] text-xs">Minimum investment is required.</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Sourced By */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Sourced By </Label>
                    <div className="space-y-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid="select-sourced-by"
                          >
                            <span className="text-muted-foreground">
                              {formData.approvedBy.length > 0
                                ? formData.approvedBy.map((id) => approvedByOptions.find((a) => String(a.id) === id)?.name ?? id).join(", ")
                                : "Select Sourced By"}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-2" align="start">
                          <div className="max-h-48 overflow-y-auto">
                            {approvedByOptions.map((a) => (
                              <div
                                key={a.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                                onClick={() => toggleApprover(String(a.id))}
                              >
                                <Checkbox
                                  checked={formData.approvedBy.includes(String(a.id))}
                                  onCheckedChange={() => toggleApprover(String(a.id))}
                                  className="pointer-events-none"
                                />
                                <span className="text-sm">{a.name}</span>
                              </div>
                            ))}
                            {approvedByOptions.length === 0 && <p className="text-sm text-muted-foreground px-2 py-1">No options available</p>}
                          </div>
                        </PopoverContent>
                      </Popover>
                      {formData.approvedBy.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {formData.approvedBy.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 rounded bg-[#405189]/10 text-[#405189] px-2.5 py-1 text-xs font-medium"
                            >
                              {approvedByOptions.find((a) => String(a.id) === id)?.name ?? id}
                              <button
                                type="button"
                                className="ml-0.5 hover:text-[#f06548] transition-colors"
                                onClick={() => toggleApprover(id)}
                                aria-label={`Remove ${approvedByOptions.find((a) => String(a.id) === id)?.name ?? id}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Special Filters */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Special Filters</Label>
                    {investmentDataFailed ? (
                      <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                        <span className="text-sm text-destructive">Failed to load filter options.</span>
                        <button
                          type="button"
                          className="text-sm font-medium text-[#405189] hover:underline"
                          onClick={retryLoadInvestmentData}
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <TagSelectPopover options={allTagOptions} selected={formData.investmentTagValues} onToggle={toggleTagValue} testId="multiselect-tags" />
                    )}
                  </div>
                </div>

                {/* Combined Links Block for Sourced By and Special Filters */}
                {(formData.approvedBy.length > 0 || formData.investmentTagValues.length > 0) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Sourced By Links */}
                    {formData.approvedBy.length > 0 ? (
                      <div className="space-y-1.5">
                        <Label className="text-sm">Sourced By Links</Label>
                        <div className={cn("rounded-md border p-3 space-y-3 relative", isSourcedByDirty && "select-none")}>
                          <div className={cn("space-y-3", isSourcedByDirty && "blur-[2px] opacity-60 pointer-events-none")}>
                            {formData.approvedBy.map((id) => {
                              const approverName = (approvedByOptions.find((a) => String(a.id) === id)?.name ?? id).replace(/\s+/g, "-");
                              const link = `${import.meta.env.VITE_FRONTEND_URL}/investments?sourcedby=${approverName}`;
                              return (
                                <div key={id} className="flex items-center gap-2">
                                  <Input
                                    readOnly
                                    value={link}
                                    className="bg-muted/30 text-sm"
                                    data-testid={`input-sourced-by-link-${id}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    data-testid={`button-copy-sourced-link-${id}`}
                                    onClick={() => {
                                      navigator.clipboard.writeText(link);
                                      toast({ title: "Copied", description: "Link copied to clipboard." });
                                    }}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                          {isSourcedByDirty && (
                            <div className="absolute inset-0 flex items-center justify-center p-2">
                              <span className="text-sm font-medium text-foreground bg-background/90 px-3 py-1.5 rounded">
                                Selection changed — tap <strong>Update</strong> to refresh the link.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : <div />}

                    {/* Special Filters Links */}
                    {formData.investmentTagValues.length > 0 ? (
                      <div className="space-y-1.5">
                        <Label className="text-sm">Special Filters Links</Label>
                        <div className={cn("rounded-md border p-3 space-y-3 relative", isInvestmentTagDirty && "select-none")}>
                          <div className={cn("space-y-3", isInvestmentTagDirty && "blur-[2px] opacity-60 pointer-events-none")}>
                            {investmentTagLinks.map((url) => (
                              <div key={url} className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Input
                                    readOnly
                                    value={url}
                                    className="bg-muted/30 text-sm"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={() => {
                                      navigator.clipboard.writeText(url);
                                      toast({ title: "Copied", description: "Link copied to clipboard." });
                                    }}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={() => setOpenQR((prev) => (prev === url ? null : url))}
                                  >
                                    <QrCode className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={async () => {
                                      const tag = formData.investmentTagValues[investmentTagLinks.indexOf(url)];
                                      if (!tag || !campaignId) return;
                                      try {
                                        const res = await sendInvestmentQrCodeEmail(formData.id!, tag);
                                        if (res.success) {
                                          toast({ title: "Email Sent", description: res.message || "QR code email sent successfully." });
                                        } else {
                                          toast({ title: "Email Failed", description: res.message || "Could not send email.", variant: "destructive" });
                                        }
                                      } catch {
                                        toast({ title: "Error", description: "Failed to send QR code email.", variant: "destructive" });
                                      }
                                    }}
                                  >
                                    <Mail className="h-4 w-4" />
                                  </Button>
                                </div>
                                {openQR === url && (
                                  <div className="flex justify-center p-3 border rounded-md bg-muted/20">
                                    <QRCodeCanvas value={url} size={128} />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {isInvestmentTagDirty && (
                            <div className="absolute inset-0 flex items-center justify-center p-2">
                              <span className="text-sm font-medium text-foreground bg-background/90 px-3 py-1.5 rounded">
                                Selections changed — tap <strong>Update</strong> to refresh the links.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : <div />}
                  </div>
                )}

                {/* Featured Investment */}
                <div className="flex items-center gap-2">
                  <Checkbox id="featuredInvestment" checked={formData.featuredInvestment} onCheckedChange={(checked) => upd("featuredInvestment", !!checked)} data-testid="checkbox-featured" />
                  <Label htmlFor="featuredInvestment" className="text-sm font-normal cursor-pointer">Featured Investment</Label>
                </div>

                <div className="space-y-1.5" ref={propertyRef}>
                  <Label htmlFor="property" className="text-sm">Investment Name for URL <span className="text-[#f06548]">*</span></Label>
                  <Input id="property" value={formData.property} onChange={(e) => upd("property", e.target.value.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, ""))} placeholder="Enter investment name for URL" className={fe("property")} data-testid="input-property" />
                  {errors.property && <p className="text-[#f06548] text-xs">{propertyError || "Investment name for URL is required."}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Investment Stage */}
                  <div className="space-y-1.5" ref={stageRef}>
                    <Label className="text-sm">Investment Stage <span className="text-[#f06548]">*</span></Label>
                    <Select value={formData.stage} onValueChange={(val) => upd("stage", val)}>
                      <SelectTrigger className={fe("stage")} data-testid="select-stage"><SelectValue placeholder="Select Stage" /></SelectTrigger>
                      <SelectContent>
                        {STAGE_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.stage && <p className="text-[#f06548] text-xs">Investment stage is required.</p>}
                  </div>

                  {/* Private Groups */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Private Groups</Label>
                    <Select value={formData.privateGroupID || "null"} onValueChange={(val) => upd("privateGroupID", val === "null" ? "" : val)}>
                      <SelectTrigger data-testid="select-private-group"><SelectValue placeholder="Select a Private Group" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="null">Select a Private Group</SelectItem>
                        {groups.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Owning Group (admin: campaign-owns-group + auto-enroll) */}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Owning Group</Label>
                    <Select value={formData.ownerGroupId || "null"} onValueChange={(val) => upd("ownerGroupId", val === "null" ? "" : val)}>
                      <SelectTrigger data-testid="select-owner-group"><SelectValue placeholder="No owning group" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="null">No owning group</SelectItem>
                        {groups.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The group this campaign belongs to. Investors can be auto-added as members below.
                    </p>
                  </div>
                </div>

                {/* Auto-enroll investors into the owning group */}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="autoEnrollInvestors"
                    checked={formData.autoEnrollInvestors}
                    disabled={!formData.ownerGroupId}
                    onCheckedChange={(checked) => upd("autoEnrollInvestors", !!checked)}
                    data-testid="checkbox-auto-enroll-investors"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="autoEnrollInvestors" className="text-sm font-normal cursor-pointer">
                      Auto-enroll investors as members of the owning group
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      When enabled, every new investor in this campaign is added to the owning group as an accepted member (existing members are unaffected).
                    </p>
                  </div>
                </div>

                {/* Is Active */}
                <div className="flex items-center gap-2">
                  <Checkbox id="isActive" checked={formData.isActive} onCheckedChange={(checked) => upd("isActive", !!checked)} data-testid="checkbox-is-active" />
                  <Label htmlFor="isActive" className="text-sm font-normal cursor-pointer">Is Active</Label>
                </div>

                {/* Is this investment part of a Fund? */}
                <div className="flex items-center gap-2">
                  <Checkbox id="isPartOfFund" checked={formData.isPartOfFund} onCheckedChange={(checked) => upd("isPartOfFund", !!checked)} data-testid="checkbox-is-part-of-fund" />
                  <Label htmlFor="isPartOfFund" className="text-sm font-normal cursor-pointer">Is this investment part of a Fund?</Label>
                </div>

                {formData.isPartOfFund && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Associated Fund <span className="text-[#f06548]">*</span></Label>
                    <Select
                      value={formData.associatedFundId ? String(formData.associatedFundId) : "none"}
                      onValueChange={(val) => upd("associatedFundId", val === "none" ? null : Number(val))}
                    >
                      <SelectTrigger data-testid="select-associated-fund">
                        <SelectValue placeholder="Select a Fund" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select a Fund</SelectItem>
                        {investmentOptions.map((opt) => (
                          <SelectItem key={opt.id} value={String(opt.id)}>
                            {opt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Total raised outside of CataCap */}
                <div className="space-y-1.5" ref={raisedRef}>
                  <Label htmlFor="addedTotalAdminRaised" className="text-sm">Total raised outside of CataCap <span className="text-[#f06548]">*</span></Label>
                  <Input id="addedTotalAdminRaised" type="number" min={0} step={1} value={formData.addedTotalAdminRaised} onChange={(e) => upd("addedTotalAdminRaised", e.target.value.replace(/[^0-9]/g, ""))} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => { if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault(); }} placeholder="Enter total raised to Date" className={fe("addedTotalAdminRaised")} data-testid="input-admin-raised" />
                  {errors.addedTotalAdminRaised && <p className="text-[#f06548] text-xs">Total raised outside of CataCap is required.</p>}
                </div>
              </CardContent>
            </Card>
        )}

        {/* ── STEP 4: ADMIN DETAILS ── */}
        {currentStep === 4 && (
          <Card className="rounded-t-none rounded-b-xl">
            <CardContent className="p-6 space-y-8">
              {/* ── Investment Type ── */}
              <div className="space-y-4">
                <h5 className="text-base font-semibold border-b pb-2 mb-4">Investment Type</h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Investment Type</Label>
                    <Select value={formData.investmentTypeCategory} onValueChange={(val) => upd("investmentTypeCategory", val)}>
                      <SelectTrigger data-testid="select-investment-type-category"><SelectValue placeholder="Select Investment Type" /></SelectTrigger>
                      <SelectContent>
                        {INVESTMENT_TYPE_CATEGORY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="equityValuation" className="text-sm">Equity / Valuation (Pre-money)</Label>
                    <Input id="equityValuation" value={formData.equityValuation} onChange={(e) => upd("equityValuation", e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="Enter numeric value" data-testid="input-equity-valuation" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="equitySecurityType" className="text-sm">Equity / Security Type</Label>
                    <Input id="equitySecurityType" value={formData.equitySecurityType} onChange={(e) => upd("equitySecurityType", e.target.value)} placeholder="Enter security type" data-testid="input-equity-security-type" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Fund / Term</Label>
                    <Popover open={fundTermOpen} onOpenChange={setFundTermOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formData.fundTerm && "text-muted-foreground")} data-testid="button-fund-term">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formData.fundTerm ? formatDate(formData.fundTerm, "") : "MM/DD/YYYY"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formData.fundTerm ? new Date(formData.fundTerm) : undefined} onSelect={(date) => { upd("fundTerm", date ? date.toISOString() : ""); setFundTermOpen(false); }} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              {/* ── Investment Terms ── */}
              <div className="space-y-4">
                <h5 className="text-base font-semibold border-b pb-2 mb-4">Investment Terms</h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="equityTargetReturn" className="text-sm">Equity / Funds Target Return</Label>
                    <Input id="equityTargetReturn" value={formData.equityTargetReturn} onChange={(e) => upd("equityTargetReturn", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter percentage" data-testid="input-equity-target-return" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Debt / Payment Frequency</Label>
                    <Select value={formData.debtPaymentFrequency} onValueChange={(val) => upd("debtPaymentFrequency", val)}>
                      <SelectTrigger data-testid="select-debt-frequency"><SelectValue placeholder="Select Frequency" /></SelectTrigger>
                      <SelectContent>
                        {DEBT_FREQUENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Debt / Maturity Date</Label>
                    <Popover open={debtMaturityOpen} onOpenChange={setDebtMaturityOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formData.debtMaturityDate && "text-muted-foreground")} data-testid="button-debt-maturity">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formData.debtMaturityDate ? formatDate(formData.debtMaturityDate, "") : "MM/DD/YYYY"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formData.debtMaturityDate ? new Date(formData.debtMaturityDate) : undefined} onSelect={(date) => { upd("debtMaturityDate", date ? date.toISOString() : ""); setDebtMaturityOpen(false); }} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="debtInterestRate" className="text-sm">Debt / Interest Rate</Label>
                    <Input id="debtInterestRate" value={formData.debtInterestRate} onChange={(e) => upd("debtInterestRate", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Enter percentage" data-testid="input-debt-interest-rate" />
                  </div>
                </div>
              </div>

              {/* ── Investment Notes ── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2 mb-4">
                  <h5 className="text-base font-semibold">Investment Notes</h5>
                  <Button
                    className="bg-[#405189] hover:bg-[#364574] text-white h-9"
                    data-testid="button-export-notes"
                    onClick={async () => {
                      if (!campaignId) return;
                      try {
                        await exportInvestmentNotesApi(formData.id!, investmentName);
                        toast({ title: "Export Complete", description: "Notes exported successfully." });
                      } catch (err: any) {
                        toast({ title: "Export Failed", description: err.message || "Could not export notes.", variant: "destructive" });
                      }
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Notes
                  </Button>
                </div>
                <div>
                  {investmentNotes.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Username</TableHead>
                          <TableHead className="text-xs">From</TableHead>
                          <TableHead className="text-xs">To</TableHead>
                          <TableHead className="text-xs">Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {investmentNotes.map((note, idx) => (
                          <TableRow key={idx} data-testid={`row-note-${idx}`}>
                            <TableCell className="text-sm">{note.date}</TableCell>
                            <TableCell className="text-sm">{note.userName}</TableCell>
                            <TableCell className="text-sm">{note.oldStatus ?? "—"}</TableCell>
                            <TableCell className="text-sm">{note.newStatus ?? "—"}</TableCell>
                            <TableCell className="text-sm">
                              <div dangerouslySetInnerHTML={{ __html: note.note }} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No notes recorded yet.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 5: UPDATES ── */}
        {currentStep === 5 && !updatesDisabled && (
          <Card className="rounded-t-none rounded-b-xl">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between border-b pb-2 mb-4">
                <h5 className="text-base font-semibold">Investment Updates</h5>
                <Button
                  className="bg-[#405189] hover:bg-[#364574] text-white h-9"
                  onClick={openNewUpdateForm}
                  data-testid="button-new-update"
                >
                  New Update
                </Button>
              </div>

              {updatesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : campaignUpdates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-no-updates">
                  No updates yet. Click "New Update" to post the first one.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full" data-testid="table-updates">
                    <thead>
                      <tr className="border-b bg-[#405189] text-white">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">File</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Subject</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Start Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">End Date</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaignUpdates.map((item) => {
                        const plainDesc = (item.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                        const shortDesc = plainDesc.length > 90 ? plainDesc.slice(0, 89) + "…" : plainDesc;
                        return (
                          <tr key={item.id} className="border-b last:border-b-0 odd:bg-card even:bg-muted/30 hover:bg-muted/20 transition-colors" data-testid={`row-update-${item.id}`}>
                            <td className="px-4 py-3">
                              {(() => {
                                const list = item.attachments || [];
                                if (list.length === 0) {
                                  return (
                                    <div className="h-12 w-12 flex items-center justify-center rounded bg-muted text-muted-foreground">
                                      <ImageIcon className="h-4 w-4" />
                                    </div>
                                  );
                                }
                                const first = list[0];
                                const extra = list.length - 1;
                                const url = first.fileUrl;
                                const name = first.fileName || (first.filePath ? first.filePath.split("/").pop() : "");
                                const isImg =
                                  (first.mimeType && first.mimeType.startsWith("image/")) ||
                                  (!!url && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
                                const tooltipText = list
                                  .map((a, i) => `${i + 1}. ${a.fileName || (a.filePath ? a.filePath.split("/").pop() : "Attachment")}`)
                                  .join("\n");
                                return (
                                  <div className="flex items-center gap-2" title={tooltipText}>
                                    {isImg && url ? (
                                      <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                                        <img src={url} alt={item.subject} className="h-12 w-12 object-cover rounded" />
                                      </a>
                                    ) : url ? (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                                      >
                                        <FileText className="h-4 w-4" />
                                        <span className="truncate max-w-[140px]">{name || "Attachment"}</span>
                                      </a>
                                    ) : (
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <FileText className="h-4 w-4" />
                                        <span className="truncate max-w-[140px]">{name || "Attachment"}</span>
                                      </div>
                                    )}
                                    {extra > 0 && (
                                      <span
                                        className="inline-flex items-center justify-center rounded-full bg-[#405189]/10 text-[#405189] text-[11px] font-semibold px-2 py-0.5"
                                        data-testid={`badge-attachments-extra-${item.id}`}
                                      >
                                        +{extra}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium">{item.subject}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs">
                              <span className="line-clamp-1" title={plainDesc}>
                                {shortDesc || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm whitespace-nowrap">
                              {item.startDate ? formatDate(item.startDate, "") : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm whitespace-nowrap">
                              {item.endDate ? formatDate(item.endDate, "") : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                  onClick={() => openEmailLogsModal(item)}
                                  data-testid={`button-email-logs-${item.id}`}
                                  title="Email send history"
                                >
                                  <Clock className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-none border-r-0 text-[#0ab39c] hover:text-[#0ab39c] hover:bg-[#0ab39c]/5"
                                  onClick={async () => {
                                    setEmailUpdateTarget(item);
                                    setEmailPreview(null);
                                    if (!resolvedNumericId) return;
                                    setEmailPreviewLoading(true);
                                    try {
                                      const res = await getCampaignUpdateEmailPreview(resolvedNumericId, item.id);
                                      if (res.success === false) throw new Error(res.message || "Could not load preview.");
                                      setEmailPreview({
                                        subject: res.subject || "",
                                        bodyHtml: res.bodyHtml || "",
                                        from: res.from || "",
                                        cc: res.cc || [],
                                        recipientCount: res.recipientCount || 0,
                                      });
                                    } catch (err: any) {
                                      toast({ title: "Preview failed", description: err?.message || "Could not load email preview.", variant: "destructive" });
                                    } finally {
                                      setEmailPreviewLoading(false);
                                    }
                                  }}
                                  disabled={sendingEmailUpdateId === item.id}
                                  data-testid={`button-send-update-email-${item.id}`}
                                  title="Send email to all investors"
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-none border-r-0 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5"
                                  onClick={() => openEditUpdateForm(item)}
                                  data-testid={`button-edit-update-${item.id}`}
                                  title="Edit update"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                  onClick={() => setDeleteUpdateTarget(item)}
                                  data-testid={`button-delete-update-${item.id}`}
                                  title="Delete update"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {currentStep === 5 && updatesDisabled && (
          <Card className="rounded-t-none rounded-b-xl">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                Updates are not available for investments that are Closed - Not Invested.
              </p>
            </CardContent>
          </Card>
        )}

        <Dialog open={updateFormOpen} onOpenChange={(open) => { setUpdateFormOpen(open); if (!open) resetUpdateForm(); }}>
          <DialogContent className="w-[95vw] sm:w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>{editingUpdateId ? "Edit Update" : "New Update"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="update-subject" className="text-sm">Subject <span className="text-[#f06548]">*</span></Label>
                <Input
                  id="update-subject"
                  value={updateForm.subject}
                  onChange={(e) => setUpdateForm((p) => ({ ...p, subject: e.target.value }))}
                  data-testid="input-update-subject"
                />
                {updateFormErrors.subject && <p className="text-[#f06548] text-xs">{updateFormErrors.subject}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="update-description" className="text-sm">Description <span className="text-[#f06548]">*</span></Label>
                <RichTextEditor
                  value={updateForm.description}
                  onChange={(val) => setUpdateForm((p) => ({ ...p, description: val }))}
                  placeholder="Update description"
                  data-testid="input-update-description"
                  maxLength={3000}
                />
                {updateFormErrors.description && <p className="text-[#f06548] text-xs">{updateFormErrors.description}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="update-short-description" className="text-sm">Short Description</Label>
                <Textarea
                  id="update-short-description"
                  rows={2}
                  maxLength={240}
                  placeholder="Notification body (defaults to truncated Description)"
                  value={updateForm.shortDescription}
                  onChange={(e) => setUpdateForm((p) => ({ ...p, shortDescription: e.target.value }))}
                  data-testid="input-update-short-description"
                />
                <p className="text-[11px] text-muted-foreground">Used as the in-app notification body.</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Impact Highlights</Label>
                <p className="text-[11px] text-muted-foreground">
                  Up to three custom (Label, Value) pairs shown alongside this update. Leave blank to skip.
                </p>
                <div className="space-y-2">
                  {updateForm.impactHighlights.map((row, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                      data-testid={`row-update-impact-highlight-${idx}`}
                    >
                      <Input
                        value={row.label}
                        maxLength={200}
                        placeholder={`Custom Label ${idx + 1}`}
                        aria-label={`Impact highlight ${idx + 1} label`}
                        onChange={(e) => {
                          const next = updateForm.impactHighlights.slice();
                          next[idx] = { ...next[idx], label: e.target.value };
                          setUpdateForm((p) => ({ ...p, impactHighlights: next }));
                        }}
                        data-testid={`input-update-impact-highlight-label-${idx}`}
                      />
                      <Input
                        value={row.value}
                        maxLength={200}
                        placeholder={`Custom Value ${idx + 1}`}
                        aria-label={`Impact highlight ${idx + 1} value`}
                        onChange={(e) => {
                          const next = updateForm.impactHighlights.slice();
                          next[idx] = { ...next[idx], value: e.target.value };
                          setUpdateForm((p) => ({ ...p, impactHighlights: next }));
                        }}
                        data-testid={`input-update-impact-highlight-value-${idx}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Attachments</Label>
                <Input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(e) => {
                    handleUpdateAttachFilesAdd(e.target.files);
                    // Reset the input so the same file can be re-selected after
                    // it's removed from the list.
                    if (e.target) e.target.value = "";
                  }}
                  data-testid="input-update-attach-file"
                  className="cursor-pointer file:cursor-pointer"
                />
                <p className="text-[11px] text-muted-foreground">Images, PDF, Word, Excel, PowerPoint, TXT or CSV (max 10MB each). All files are sent to investors as real email attachments.</p>
                {updateForm.attachments.length > 0 && (
                  <ul className="mt-2 space-y-2" data-testid="list-update-attachments">
                    {updateForm.attachments.map((att, idx) => {
                      const key = att.kind === "existing" ? `e-${att.id}` : `n-${att.tempId}`;
                      return (
                        <li
                          key={key}
                          className="flex items-center gap-3 rounded border bg-muted/30 px-3 py-2"
                          data-testid={`row-update-attachment-${idx}`}
                        >
                          {att.previewUrl ? (
                            <img
                              src={att.previewUrl}
                              alt={att.fileName}
                              className="h-10 w-10 object-cover rounded border shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 flex items-center justify-center rounded border bg-background shrink-0">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate" title={att.fileName}>
                              {att.fileName || "Attachment"}
                            </div>
                            {att.kind === "new" ? (
                              <div className="text-[11px] text-muted-foreground">
                                {(att.sizeBytes / 1024).toFixed(1)} KB · pending upload
                              </div>
                            ) : att.sizeBytes ? (
                              <div className="text-[11px] text-muted-foreground">
                                {(att.sizeBytes / 1024).toFixed(1)} KB
                              </div>
                            ) : null}
                          </div>
                          {att.kind === "existing" && att.fileUrl && (
                            <a
                              href={att.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline shrink-0"
                            >
                              Open
                            </a>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/10 shrink-0"
                            onClick={() => handleRemoveStagedAttachment(idx)}
                            data-testid={`button-remove-update-attachment-${idx}`}
                            title="Remove attachment"
                          >
                            <XIcon className="h-4 w-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {updateFormErrors.attachments && (
                  <p className="text-[#f06548] text-xs">{updateFormErrors.attachments}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm flex items-center gap-1.5">
                    Start Date
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground" data-testid="tooltip-update-start-date">
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-xs">
                        The date this update starts being shown to investors. In-app notifications are sent on this date.
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Popover open={updateStartOpen} onOpenChange={setUpdateStartOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !updateForm.startDate && "text-muted-foreground")} data-testid="button-update-start-date">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {updateForm.startDate ? formatDate(updateForm.startDate, "") : "MM/DD/YYYY"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={updateForm.startDate ? new Date(updateForm.startDate) : undefined}
                        onSelect={(date) => {
                          setUpdateForm((p) => {
                            const next = { ...p, startDate: date ? date.toISOString() : "" };
                            if (date && p.endDate && new Date(p.endDate) <= date) {
                              next.endDate = "";
                            }
                            return next;
                          });
                          setUpdateStartOpen(false);
                        }}
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return date < today;
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {updateFormErrors.startDate && <p className="text-[#f06548] text-xs">{updateFormErrors.startDate}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm flex items-center gap-1.5">
                    End Date
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground" data-testid="tooltip-update-end-date">
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-xs">
                        The date this update stops being shown to investors. After this date the update is no longer visible.
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Popover open={updateEndOpen} onOpenChange={setUpdateEndOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !updateForm.endDate && "text-muted-foreground")} data-testid="button-update-end-date">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {updateForm.endDate ? formatDate(updateForm.endDate, "") : "MM/DD/YYYY"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={updateForm.endDate ? new Date(updateForm.endDate) : undefined}
                        onSelect={(date) => { setUpdateForm((p) => ({ ...p, endDate: date ? date.toISOString() : "" })); setUpdateEndOpen(false); }}
                        disabled={(date) => {
                          const minDate = new Date();
                          minDate.setHours(0, 0, 0, 0);
                          if (updateForm.startDate) {
                            const start = new Date(updateForm.startDate);
                            start.setHours(0, 0, 0, 0);
                            if (start > minDate) minDate.setTime(start.getTime());
                          }
                          return date <= minDate;
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {updateFormErrors.endDate && <p className="text-[#f06548] text-xs">{updateFormErrors.endDate}</p>}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setUpdateFormOpen(false); resetUpdateForm(); }} disabled={updatesSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={submitUpdateForm}
                disabled={updatesSubmitting}
                className="bg-[#405189] hover:bg-[#364574] text-white"
                data-testid="button-submit-update"
              >
                {updatesSubmitting ? "Saving…" : editingUpdateId ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={emailUpdateTarget !== null}
          onOpenChange={(open) => {
            if (!open && sendingEmailUpdateId === null) {
              setEmailUpdateTarget(null);
              setEmailPreview(null);
            }
          }}
        >
          <DialogContent className="w-[95vw] sm:w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="p-4 sm:p-6 pb-3 border-b space-y-2">
              <DialogTitle>Send email to investors?</DialogTitle>
              <p className="text-sm text-muted-foreground">
                This will email all investors of this investment about the update
                {emailUpdateTarget?.subject ? <> &ldquo;<strong className="text-foreground">{emailUpdateTarget.subject}</strong>&rdquo;</> : null},
                with the Investment Owner CC&rsquo;d. Below is the email preview that will be sent to the investors.
              </p>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              {emailPreviewLoading || !emailPreview ? (
                <div className="text-sm text-muted-foreground py-12 text-center">Loading preview…</div>
              ) : (
                <>
                  <div className="rounded-md border overflow-hidden bg-white">
                    <iframe
                      title="Email preview"
                      srcDoc={emailPreview.bodyHtml}
                      sandbox=""
                      className="w-full"
                      style={{ height: "55vh", border: 0 }}
                      data-testid="iframe-email-preview"
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="p-4 sm:p-6 pt-3 border-t bg-background">
              <Button
                variant="outline"
                onClick={() => { setEmailUpdateTarget(null); setEmailPreview(null); }}
                disabled={sendingEmailUpdateId !== null}
                data-testid="button-cancel-send-update-email"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmSendUpdateEmail}
                disabled={sendingEmailUpdateId !== null || emailPreviewLoading || !emailPreview}
                className="bg-[#405189] hover:bg-[#364574] text-white"
                data-testid="button-confirm-send-update-email"
              >
                {sendingEmailUpdateId !== null ? "Sending…" : "Send email"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deleteUpdateTarget !== null}
          onOpenChange={(open) => { if (!open && deletingUpdateId === null) setDeleteUpdateTarget(null); }}
        >
          <DialogContent className="w-[95vw] sm:w-full max-w-md p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Delete update?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Delete the update
              {deleteUpdateTarget?.subject ? <> &ldquo;<strong className="text-foreground">{deleteUpdateTarget.subject}</strong>&rdquo;</> : null}?
              This action cannot be undone from the UI.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteUpdateTarget(null)}
                disabled={deletingUpdateId !== null}
                data-testid="button-cancel-delete-update"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteUpdate}
                disabled={deletingUpdateId !== null}
                className="bg-[#f06548] hover:bg-[#d4543a] text-white"
                data-testid="button-confirm-delete-update"
              >
                {deletingUpdateId !== null ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Per-update email send history modal: triggered by the Clock icon
            in the Updates table Actions column. Lists every Send action
            most-recent first with Date / Time (EST/EDT) / Recipient count. */}
        <Dialog
          open={emailLogsTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEmailLogsTarget(null);
              setEmailLogs([]);
            }
          }}
        >
          <DialogContent className="w-[95vw] sm:w-full max-w-2xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Email send history</DialogTitle>
              {emailLogsTarget?.subject && (
                <p className="text-sm text-muted-foreground">
                  Update: <strong className="text-foreground">{emailLogsTarget.subject}</strong>
                </p>
              )}
            </DialogHeader>
            {emailLogsLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : emailLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-email-logs">
                No emails have been sent for this update yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full" data-testid="table-email-logs">
                  <thead>
                    <tr className="border-b bg-[#405189] text-white">
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Time</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Recipients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b last:border-b-0 odd:bg-card even:bg-muted/30"
                        data-testid={`row-email-log-${log.id}`}
                      >
                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatEasternDate(log.sentAt)}</td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">{formatEasternTime(log.sentAt)}</td>
                        <td className="px-4 py-2 text-sm text-right whitespace-nowrap">{log.recipientCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEmailLogsTarget(null);
                  setEmailLogs([]);
                }}
                data-testid="button-close-email-logs"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex items-center justify-between gap-3 mt-8 pt-5 border-t">
          {currentStep > 0 ? (
            <Button variant="outline" onClick={() => setCurrentStep(currentStep - 1)} data-testid="button-previous">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Previous
            </Button>
          ) : (
            <div />
          )}

          {currentStep < lastNavigableStepIdx ? (
            <Button
              onClick={() => {
                let next = currentStep + 1;
                if (updatesDisabled && next === 5) next = 4;
                setCurrentStep(next);
              }}
              className="bg-[#405189] hover:bg-[#364574] text-white"
              data-testid="button-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSaveClick}
              disabled={isSubmitting}
              className="bg-[#405189] hover:bg-[#364574] text-white"
              data-testid="button-submit"
            >
              {isSubmitting ? "Updating…" : "Update"}
            </Button>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
