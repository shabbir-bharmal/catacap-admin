import { useState, useRef, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { createInvestment, updateInvestment, fetchInvestmentById, fetchInvestmentData, fetchCountries } from "../api/investment/investmentApi";
import { fetchStaticValues, StaticValueItem } from "@/api/site-configuration/siteConfigurationApi";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "../components/RichTextEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatDate } from "@/helpers/format";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Send, User, Briefcase, ImageIcon, Upload, CheckCircle2, CalendarIcon, Check, ChevronDown } from "lucide-react";
import BannerCropper from "@/components/BannerCropper";
import { defaultImage, getUrlBlobContainerImage } from "@/lib/image-utils";

const STEPS = [
  { id: 0, label: "About You", icon: User },
  { id: 1, label: "About the Investment", icon: Briefcase },
  { id: 2, label: "Media", icon: ImageIcon }
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington DC", "West Virginia",
  "Wisconsin", "Wyoming",
];

const REFERRAL_OPTIONS = ["Search Engine (Google, Bing, etc.)", "LinkedIn", "Friend or Colleague", "Conference or Event", "CataCap Team Member", "Newsletter", "Other"];

interface FormData {
  firstName: string;
  lastName: string;
  orgEmail: string;
  investmentInfoEmail: string;
  mobile: string;
  companyLocation: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  otherCountryAddress: string;
  howMuchMoney: string;
  aboutNetwork: string;
  receivedFundingBefore: string;
  hasCorporateBankAccount: string;
  hasPersonalFinancialBenefit: string;
  personalFinancialBenefitDescription: string;
  hasRegulatoryIssues: string;
  regulatoryIssuesDescription: string;
  isInGoodLegalStanding: string;
  role: string;
  referralSource: string;
  investmentName: string;
  aboutInvestment: string;
  investmentDescription: string;
  investmentWebsite: string;
  investmentType: number[];
  investmentTerms: string;
  fundraisingGoal: string;
  missionVision: string;
  expectedCloseDate: string;
  evergreen: boolean;
  thankYouMessage: string;
  investmentThemes: number[];
  sdgs: number[];
  featuredInvestment: boolean;
  logoFile: File | null;
  profileImageFile: File | null;
  smallerImageFile: File | null;
  pitchDeckFile: File | null;
  logoFileName?: string;
  imageFileName?: string;
  tileImageFileName?: string;
  pdfFileName?: string;
  originalPdfFileName?: string;
  metaTitle: string;
  metaDescription: string;
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

const defaultFormData: FormData = {
  firstName: "",
  lastName: "",
  orgEmail: "",
  investmentInfoEmail: "",
  mobile: "",
  companyLocation: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  zipCode: "",
  otherCountryAddress: "",
  howMuchMoney: "",
  aboutNetwork: "",
  receivedFundingBefore: "no",
  hasCorporateBankAccount: "",
  hasPersonalFinancialBenefit: "",
  personalFinancialBenefitDescription: "",
  hasRegulatoryIssues: "",
  regulatoryIssuesDescription: "",
  isInGoodLegalStanding: "",
  role: "",
  referralSource: "",
  investmentName: "",
  aboutInvestment: "",
  investmentDescription: "",
  investmentWebsite: "",
  investmentType: [],
  investmentTerms: "",
  fundraisingGoal: "",
  missionVision: "",
  expectedCloseDate: "",
  evergreen: false,
  thankYouMessage: "",
  investmentThemes: [],
  sdgs: [],
  featuredInvestment: false,
  logoFile: null,
  profileImageFile: null,
  smallerImageFile: null,
  pitchDeckFile: null,
  logoFileName: "",
  imageFileName: "",
  tileImageFileName: "",
  pdfFileName: "",
  originalPdfFileName: "",
  metaTitle: "",
  metaDescription: ""
};

const STEP_REQUIRED_FIELDS: Record<number, (keyof FormData)[]> = {
  0: ["firstName", "lastName", "orgEmail", "investmentInfoEmail", "mobile", "howMuchMoney", "aboutNetwork", "receivedFundingBefore", "hasCorporateBankAccount", "hasPersonalFinancialBenefit", "hasRegulatoryIssues", "isInGoodLegalStanding", "role", "companyLocation"],
  1: ["investmentName", "aboutInvestment", "investmentWebsite", "investmentType", "investmentTerms", "fundraisingGoal", "missionVision", "thankYouMessage", "investmentThemes", "sdgs"],
  2: ["logoFile", "profileImageFile", "smallerImageFile", "pitchDeckFile"]
};

const STEP_REQUIRED_FIELDS_EDIT: Record<number, (keyof FormData)[]> = {
  0: ["firstName", "lastName", "orgEmail", "investmentInfoEmail", "mobile", "howMuchMoney", "aboutNetwork", "receivedFundingBefore", "hasCorporateBankAccount", "hasPersonalFinancialBenefit", "hasRegulatoryIssues", "isInGoodLegalStanding", "role", "companyLocation"],
  1: ["investmentName", "aboutInvestment", "investmentWebsite", "investmentType", "investmentTerms", "fundraisingGoal", "missionVision", "thankYouMessage", "investmentThemes", "sdgs"],
  2: []
};

// ── Validation helpers ───────────────────────────────────────────────────────
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const URL_REGEX = /^(https?:\/\/)?(\w[\w.-]+)\.([a-z]{2,})(\/[\w .-]*)*\/?$/i;
const NAME_REGEX = /^[A-Za-z0-9_ ]+$/;
const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim();

const ALLOWED_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif"];
const fileExt = (name: string) => name.substring(name.lastIndexOf(".")).toLowerCase();

function isStepValid(step: number, data: FormData, editMode = false): boolean {
  const fields = editMode ? STEP_REQUIRED_FIELDS_EDIT : STEP_REQUIRED_FIELDS;
  const requiredFields = fields[step] || [];
  const basicFieldsValid = requiredFields.every((field) => {
    const val = data[field];
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === "string") return val.trim().length > 0;
    return val !== null && val !== undefined;
  });

  if (!basicFieldsValid) return false;

  if (step === 0) {
    return !!(data.address1.trim() && data.city.trim() && data.state && data.zipCode.trim());
  }

  return true;
}

function isFormComplete(data: FormData, editMode = false): boolean {
  return [0, 1, 2].every((step) => isStepValid(step, data, editMode));
}

export default function AdminRaiseMoney() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const editId = searchParams.get("edit");
  const isEditMode = !!editId;
  const [isFetchingEdit, setIsFetchingEdit] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [countries, setCountries] = useState<any[]>([]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const [themes, setThemes] = useState<any[]>([]);
  const [sdgOptions, setSdgOptions] = useState<any[]>([]);
  const [investmentTypes, setInvestmentTypes] = useState<any[]>([]);
  const [investmentTypeOpen, setInvestmentTypeOpen] = useState(false);
  const [staticTerms, setStaticTerms] = useState<StaticValueItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const logoRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLInputElement>(null);
  const smallerRef = useRef<HTMLInputElement>(null);
  const pitchDeckRef = useRef<HTMLInputElement>(null);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string | null>(null);
  const [cropperTarget, setCropperTarget] = useState<"profile" | "tile" | null>(null);
  const [cropperAspect, setCropperAspect] = useState(763 / 400);

  const handleCropSave = useCallback(async (file: File, previewUrl: string) => {
    if (cropperTarget === "profile") {
      updateField("profileImageFile", file);
      updateField("imageFileName", "");
    } else if (cropperTarget === "tile") {
      updateField("smallerImageFile", file);
      updateField("tileImageFileName", "");
    }
    setCropperOpen(false);
    setCropperImage(null);
    setCropperTarget(null);
  }, [cropperTarget]);

  useEffect(() => {
    const loadDynamicData = async () => {
      try {
        const [countriesData, investmentData, staticTermsData] = await Promise.all([fetchCountries(), fetchInvestmentData(), fetchStaticValues()]);
        setCountries(countriesData || []);
        setThemes(investmentData.theme || []);
        setSdgOptions(investmentData.sdg || []);
        setInvestmentTypes(investmentData.investmentType || []);
        setStaticTerms(staticTermsData || []);
      } catch (err) {
        console.error("Failed to fetch dynamic data", err);
      }
    };
    loadDynamicData();
  }, []);

  useEffect(() => {
    if (isEditMode && editId) {
      setIsFetchingEdit(true);
      fetchInvestmentById(Number(editId))
        .then((inv: any) => {
          const sdgsArr = inv.sdGs
            ? inv.sdGs
              .split(",")
              .map((s: string) => Number(s.trim()))
              .filter((n: number) => !isNaN(n))
            : [];
          const themesArr = inv.themes
            ? inv.themes
              .split(",")
              .map((t: string) => Number(t.trim()))
              .filter((n: number) => !isNaN(n))
            : [];
          const fullName: string = inv.contactInfoFullName || "";
          const nameParts = fullName.split(" ");
          const derivedFirstName = inv.firstName || nameParts[0] || "";
          const derivedLastName = inv.lastName || nameParts.slice(1).join(" ") || "";

          const isEvergreen = inv.fundraisingCloseDate === "Evergreen";

          setFormData({
            firstName: derivedFirstName,
            lastName: derivedLastName,
            orgEmail: inv.contactInfoEmailAddress || "",
            investmentInfoEmail: inv.investmentInformationalEmail || "",
            mobile: inv.contactInfoPhoneNumber || "",
            companyLocation: inv.country === "United States" || inv.country === "USA" ? "USA" : inv.country || "",
            address1: inv.contactInfoAddress || "",
            address2: inv.ContactInfoAddress2 || "",
            city: inv.city || "",
            state: inv.state || "",
            zipCode: inv.zipCode || "",
            otherCountryAddress: inv.otherCountryAddress || "",
            howMuchMoney: inv.target ? String(inv.target) : "",
            aboutNetwork: inv.networkDescription || "",
            receivedFundingBefore: inv.impactAssetsFundingStatus === "yes" ? "yes" : inv.impactAssetsFundingStatus === "notsure" ? "notsure" : "no",
            hasCorporateBankAccount: inv.hasCorporateBankAccount === true ? "yes" : inv.hasCorporateBankAccount === false ? "no" : "",
            hasPersonalFinancialBenefit: inv.hasPersonalFinancialBenefit === true ? "yes" : inv.hasPersonalFinancialBenefit === false ? "no" : "",
            personalFinancialBenefitDescription: inv.personalFinancialBenefitDescription || "",
            hasRegulatoryIssues: inv.hasRegulatoryIssues === true ? "yes" : inv.hasRegulatoryIssues === false ? "no" : "",
            regulatoryIssuesDescription: inv.regulatoryIssuesDescription || "",
            isInGoodLegalStanding: inv.isInGoodLegalStanding === true ? "yes" : inv.isInGoodLegalStanding === false ? "no" : "",
            role: inv.investmentRole || "",
            referralSource: inv.referredToCataCap || "",
            investmentName: inv.name || "",
            aboutInvestment: inv.description || "",
            investmentDescription: inv.description || "",
            investmentWebsite: inv.website || "",
            investmentType: inv.investmentTypes
              ? inv.investmentTypes
                .split(",")
                .map((t: string) => Number(t.trim()))
                .filter((n: number) => !isNaN(n))
              : [],
            investmentTerms: inv.terms || "",
            fundraisingGoal: inv.target ? String(inv.target) : "",
            missionVision: inv.missionAndVision || "",
            expectedCloseDate: !isEvergreen && inv.fundraisingCloseDate ? inv.fundraisingCloseDate : "",
            evergreen: isEvergreen,
            thankYouMessage: inv.personalizedThankYou || "",
            investmentThemes: themesArr,
            sdgs: sdgsArr,
            featuredInvestment: !!inv.featuredInvestment,
            // Files are not pre-filled — user can re-upload if they want to change them
            logoFile: null,
            profileImageFile: null,
            smallerImageFile: null,
            pitchDeckFile: null,
            logoFileName: inv.logoFileName || "",
            imageFileName: inv.imageFileName || "",
            tileImageFileName: inv.tileImageFileName || "",
            pdfFileName: inv.pdfFileName || "",
            originalPdfFileName: inv.originalPdfFileName || "",
            metaTitle: inv.metaTitle || "",
            metaDescription: inv.metaDescription || ""
          });
          // Start on step 0 so admin can review/edit all steps
          setCurrentStep(0);
          localStorage.removeItem("editInvestment");
        })
        .catch((err) => {
          console.error("Failed to fetch investment for editing", err);
          toast({
            title: "Error",
            description: "Could not load investment data. Please try again.",
            variant: "destructive"
          });
        })
        .finally(() => setIsFetchingEdit(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const updateField = (field: keyof FormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as string]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
    // When Evergreen is checked, immediately clear the close-date error
    if (field === "evergreen" && value) {
      setErrors((prev) => ({ ...prev, expectedCloseDate: "" }));
    }
  };

  const toggleArrayItem = (field: "investmentThemes" | "sdgs", item: number) => {
    setFormData((prev) => {
      const arr = prev[field] as number[];
      const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
      return { ...prev, [field]: next };
    });
    // Clear the "please select at least one" error as soon as any checkbox is ticked
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const previousCountryRef = useRef<string>();

  useEffect(() => {
    const prevCountry = previousCountryRef.current;
    const selectedCountry = formData.companyLocation;

    if (prevCountry && prevCountry !== selectedCountry) {
      setFormData((prev) => ({
        ...prev,
        address1: "",
        address2: "",
        city: "",
        state: "",
        zipCode: ""
      }));
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.address1;
        delete newErrors.address2;
        delete newErrors.city;
        delete newErrors.state;
        delete newErrors.zipCode;
        return newErrors;
      });
    }

    previousCountryRef.current = selectedCountry;
  }, [formData.companyLocation]);

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    let valid = true;
    const err = (field: string, msg: string) => {
      newErrors[field] = msg;
      valid = false;
    };

    if (step === 0) {
      if (!formData.firstName.trim()) err("firstName", "First Name is required");
      else if (!NAME_REGEX.test(formData.firstName.trim())) err("firstName", "Only letters, numbers, or spaces allowed.");

      if (!formData.lastName.trim()) err("lastName", "Last Name is required");
      else if (!NAME_REGEX.test(formData.lastName.trim())) err("lastName", "Only letters, numbers, or spaces allowed.");

      if (!formData.orgEmail.trim()) err("orgEmail", "Organizational email is required");
      else if (!EMAIL_REGEX.test(formData.orgEmail)) err("orgEmail", "Invalid email format. Example: someone@mail.com");

      if (!formData.investmentInfoEmail.trim()) err("investmentInfoEmail", "Investment informational email is required");
      else if (!EMAIL_REGEX.test(formData.investmentInfoEmail)) err("investmentInfoEmail", "Invalid email format. Example: someone@mail.com");

      if (!formData.mobile.trim()) err("mobile", "Mobile number is required");
      else if (!PHONE_REGEX.test(formData.mobile)) err("mobile", "Invalid mobile number. Example: (888) 248-5496");

      if (!formData.howMuchMoney.toString().trim()) err("howMuchMoney", "Please enter the committed amount");

      if (!formData.aboutNetwork.trim()) err("aboutNetwork", "Network description is required");

      if (!formData.hasCorporateBankAccount) err("hasCorporateBankAccount", "Please select Yes or No");
      if (!formData.hasPersonalFinancialBenefit) err("hasPersonalFinancialBenefit", "Please select Yes or No");
      if (!formData.hasRegulatoryIssues) err("hasRegulatoryIssues", "Please select Yes or No");
      if (!formData.isInGoodLegalStanding) err("isInGoodLegalStanding", "Please select Yes or No");

      if (!formData.role.trim()) err("role", "Your role is required");

      if (!formData.companyLocation) {
        err("companyLocation", "Country is required");
      } else {
        if (!formData.address1.trim()) err("address1", "Address Line 1 is required");
        if (!formData.city.trim()) err("city", "City is required");
        if (!formData.state) err("state", "State is required");
        if (!formData.zipCode.trim()) err("zipCode", "Zip Code is required");
      }
    }

    if (step === 1) {
      if (!formData.investmentName.trim()) err("investmentName", "Investment Name is required");
      else if (formData.investmentName.trim().length > 100) err("investmentName", "Cannot exceed 100 characters");

      const descText = stripHtml(formData.aboutInvestment);
      if (!descText) err("aboutInvestment", "Investment description is required");
      else if (descText.length > 3000) err("aboutInvestment", "Cannot exceed 3,000 characters");

      if (!formData.investmentWebsite.trim()) err("investmentWebsite", "Website is required");
      else if (!URL_REGEX.test(formData.investmentWebsite)) err("investmentWebsite", "Invalid website URL");

      if (formData.investmentType.length === 0) err("investmentType", "Investment Instruments is required");

      const termsText = stripHtml(formData.investmentTerms);
      if (!termsText) err("investmentTerms", "Investment Terms is required");
      else if (termsText.length > 2000) err("investmentTerms", "Cannot exceed 2,000 characters");

      if (!formData.fundraisingGoal.toString().trim()) err("fundraisingGoal", "Fundraising goal is required");
      else if (!/^\d+$/.test(formData.fundraisingGoal.toString().trim())) err("fundraisingGoal", "Only positive integers are allowed");
      else if (Number(formData.fundraisingGoal) < 1) err("fundraisingGoal", "Must be at least 1");

      const mvText = stripHtml(formData.missionVision);
      if (!mvText) err("missionVision", "Mission/Vision is required");
      else if (mvText.length > 1000) err("missionVision", "Cannot exceed 1,000 characters");

      if (!formData.evergreen) {
        if (!formData.expectedCloseDate) {
          err("expectedCloseDate", "Close date is required unless Evergreen is checked");
        } else {
          const sel = new Date(formData.expectedCloseDate);
          const tmr = new Date();
          tmr.setDate(tmr.getDate() + 1);
          tmr.setHours(0, 0, 0, 0);
          if (sel < tmr) err("expectedCloseDate", "Close date must be at least tomorrow");
        }
      }

      const tyText = stripHtml(formData.thankYouMessage);
      if (!tyText) err("thankYouMessage", "Personalized Thank You is required");

      if (formData.investmentThemes.length === 0) err("investmentThemes", "Please select at least one theme");
      if (formData.sdgs.length === 0) err("sdgs", "Please select at least one SDG");
    }

    if (step === 2 && !isEditMode) {
      if (!formData.logoFile) err("logoFile", "Company/Investment Logo is required");
      if (!formData.profileImageFile) err("profileImageFile", "Profile Image is required");
      if (!formData.smallerImageFile) err("smallerImageFile", "Smaller Image is required");
      if (!formData.pitchDeckFile) err("pitchDeckFile", "Pitch Deck is required");
    }

    setErrors(newErrors);
    return valid;
  };

  // ── File upload handlers with type + size validation ──────────────────────
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_EXT.includes(fileExt(file.name))) {
      setFileErrors((p) => ({ ...p, logoFile: "Only .png / .jpg / .gif files allowed" }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileErrors((p) => ({ ...p, logoFile: "Max file size is 10 MB" }));
      return;
    }
    setFileErrors((p) => ({ ...p, logoFile: "" }));
    updateField("logoFile", file);
    updateField("logoFileName", "");
  };
  const handleProfileImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_EXT.includes(fileExt(file.name))) {
      setFileErrors((p) => ({ ...p, profileImageFile: "Only .png / .jpg / .gif files allowed" }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileErrors((p) => ({ ...p, profileImageFile: "Max file size is 10 MB" }));
      return;
    }
    setFileErrors((p) => ({ ...p, profileImageFile: "" }));
    const compressed = await compressImage(file, file.type);
    setCropperImage(URL.createObjectURL(compressed));
    setCropperTarget("profile");
    setCropperAspect(763 / 400);
    setCropperOpen(true);
  };
  const handleSmallerImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_EXT.includes(fileExt(file.name))) {
      setFileErrors((p) => ({ ...p, smallerImageFile: "Only .png / .jpg / .gif files allowed" }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileErrors((p) => ({ ...p, smallerImageFile: "Max file size is 10 MB" }));
      return;
    }
    setFileErrors((p) => ({ ...p, smallerImageFile: "" }));
    const compressed = await compressImage(file, file.type);
    setCropperImage(URL.createObjectURL(compressed));
    setCropperTarget("tile");
    setCropperAspect(362 / 250);
    setCropperOpen(true);
  };
  const handlePitchDeckChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;
    if (fileExt(file.name) !== ".pdf") {
      setFileErrors((p) => ({ ...p, pitchDeckFile: "Only PDF files are allowed" }));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFileErrors((p) => ({ ...p, pitchDeckFile: "Max file size is 20 MB" }));
      return;
    }
    setFileErrors((p) => ({ ...p, pitchDeckFile: "" }));
    updateField("pitchDeckFile", file);
    updateField("pdfFileName", "");
    updateField("originalPdfFileName", file.name);
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) {
      toast({
        title: "Required Fields",
        description: "Please fill in all required fields before proceeding.",
        variant: "destructive"
      });
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSubmit = async () => {
    if (!isFormComplete(formData, isEditMode)) {
      toast({
        title: "Incomplete Form",
        description: "Please fill in all required fields across all steps.",
        variant: "destructive"
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = {
        name: formData.investmentName,
        description: formData.aboutInvestment,
        themes: formData.investmentThemes.join(","),
        sdGs: formData.sdgs.join(","),
        investmentTypes: formData.investmentType.join(","),
        terms: formData.investmentTerms,
        website: formData.investmentWebsite,
        networkDescription: formData.aboutNetwork,
        contactInfoFullName: `${formData.firstName} ${formData.lastName}`,
        contactInfoEmailAddress: formData.orgEmail,
        investmentInformationalEmail: formData.investmentInfoEmail,
        contactInfoPhoneNumber: formData.mobile,
        country: formData.companyLocation,
        contactInfoAddress: formData.address1,
        contactInfoAddress2: formData.address2,
        city: formData.city,
        state: formData.state,
        zipCode: formData.zipCode,
        otherCountryAddress: "",
        target: formData.fundraisingGoal,
        referredToCataCap: formData.referralSource,
        investmentRole: formData.role,
        firstName: formData.firstName,
        lastName: formData.lastName,
        isActive: true,
        missionAndVision: formData.missionVision,
        personalizedThankYou: formData.thankYouMessage,
        featuredInvestment: formData.featuredInvestment,
        fundraisingCloseDate: formData.evergreen ? "Evergreen" : formData.expectedCloseDate,
        impactAssetsFundingStatus: formData.receivedFundingBefore,
        hasCorporateBankAccount: formData.hasCorporateBankAccount === "yes" ? true : formData.hasCorporateBankAccount === "no" ? false : null,
        hasPersonalFinancialBenefit: formData.hasPersonalFinancialBenefit === "yes" ? true : formData.hasPersonalFinancialBenefit === "no" ? false : null,
        personalFinancialBenefitDescription: formData.hasPersonalFinancialBenefit === "yes" ? (formData.personalFinancialBenefitDescription?.trim() || null) : null,
        hasRegulatoryIssues: formData.hasRegulatoryIssues === "yes" ? true : formData.hasRegulatoryIssues === "no" ? false : null,
        regulatoryIssuesDescription: formData.hasRegulatoryIssues === "yes" ? (formData.regulatoryIssuesDescription?.trim() || null) : null,
        isInGoodLegalStanding: formData.isInGoodLegalStanding === "yes" ? true : formData.isInGoodLegalStanding === "no" ? false : null,
        captchaToken: "",
        metaTitle: formData.metaTitle,
        metaDescription: formData.metaDescription,
        logo: formData.logoFile ? await toBase64(formData.logoFile) : "",
        image: formData.profileImageFile ? await toBase64(formData.profileImageFile) : "",
        tileImage: formData.smallerImageFile ? await toBase64(formData.smallerImageFile) : "",
        pdfPresentation: formData.pitchDeckFile ? await toBase64(formData.pitchDeckFile) : "",
        logoFileName: formData.logoFileName || "",
        imageFileName: formData.imageFileName || "",
        tileImageFileName: formData.tileImageFileName || "",
        pdfFileName: formData.pdfFileName || "",
        originalPdfFileName: formData.originalPdfFileName || ""
      };

      if (isEditMode && editId) {
        payload.id = Number(editId);
        await updateInvestment(Number(editId), payload);
        toast({
          title: "Investment Updated",
          description: `"${formData.investmentName}" has been updated successfully.`
        });
        setSubmitted(true);
      } else {
        await createInvestment(payload);
        setSubmitted(true);
        toast({
          title: "Application Submitted",
          description: "The raise money application has been submitted successfully."
        });
      }
    } catch (error) {
      console.error("Failed to submit investment", error);
      toast({
        title: isEditMode ? "Update Error" : "Submission Error",
        description: `There was an error ${isEditMode ? "updating" : "submitting"} the investment.`,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData(defaultFormData);
    setCurrentStep(0);
    setSubmitted(false);
    setErrors({});
    setFileErrors({});
  };

  const fieldError = (field: keyof FormData) => (errors[field] ? "border-[#f06548] focus-visible:ring-[#f06548]" : "");

  const fieldErrorMsg = (field: keyof FormData) => (errors[field] ? <p className="text-xs text-[#f06548] mt-1">{errors[field]}</p> : null);

  if (isFetchingEdit) {
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

  if (submitted) {
    return (
      <AdminLayout title={isEditMode ? "Edit Investment" : "Raise Money"}>
        <div className="mx-auto">
          <Card>
            <CardContent className="p-10 text-center">
              <div className="flex items-center justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-[#0ab39c]/10 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-[#0ab39c]" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2" data-testid="text-success-title">
                {isEditMode ? "Investment Updated!" : "Well Done!"}
              </h3>
              <p className="text-muted-foreground mb-6" data-testid="text-success-message">
                {isEditMode ? (
                  <>
                    The investment <span className="font-medium text-foreground">{formData.investmentName || "your investment"}</span> has been updated successfully.
                  </>
                ) : (
                  <>
                    The raise money application for <span className="font-medium text-foreground">{formData.investmentName || "your investment"}</span> has been submitted successfully. The team will
                    review and get back to you shortly.
                  </>
                )}
              </p>
              <Button onClick={handleReset} data-testid="button-submit-another">
                {isEditMode ? "Edit Another" : "Submit Another Application"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={isEditMode ? "Edit Investment" : "Raise Money"}>
      <div className="max-w-8xl mx-auto">
        <div className="mb-4">
          <h4 className="text-base font-semibold" data-testid="text-page-heading">
            {isEditMode ? "Edit Investment" : "Raise Money"}
          </h4>
          <p className="text-sm text-muted-foreground">{isEditMode ? "Update the investment details below." : "Complete the form below to submit your investment opportunity."}</p>
        </div>

        <Card className="rounded-b-none rounded-t-xl">
          <CardContent className="p-0">
            <div className="border-b">
              <nav className="flex" data-testid="step-nav">
                {STEPS.map((step, idx) => {
                  const isActive = idx === currentStep;
                  const isDone = idx < currentStep;
                  const Icon = step.icon;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors relative
                        ${isActive ? "text-[#405189] bg-[#405189]/5" : isDone ? "text-[#0ab39c]" : "text-muted-foreground"}
                        ${idx > 0 ? "border-l" : ""}
                      `}
                      onClick={() => {
                        if (isDone) setCurrentStep(idx);
                      }}
                      disabled={idx > currentStep}
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

        <Card className="rounded-t-none rounded-b-xl">
          <CardContent className="p-5 sm:p-6">
            {currentStep === 0 && (
              <div className="space-y-5" data-testid="step-about-you">
                <h5 className="text-base font-semibold mb-4">About You</h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-sm">
                      Your Name <span className="text-[#f06548]">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) => updateField("firstName", e.target.value)}
                      placeholder="First Name"
                      className={fieldError("firstName")}
                      data-testid="input-first-name"
                    />
                    {fieldErrorMsg("firstName")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-sm">
                      Last Name <span className="text-[#f06548]">*</span>
                    </Label>
                    <Input
                      id="lastName"
                      value={formData.lastName}
                      onChange={(e) => updateField("lastName", e.target.value)}
                      placeholder="Last Name"
                      className={fieldError("lastName")}
                      data-testid="input-last-name"
                    />
                    {fieldErrorMsg("lastName")}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="orgEmail" className="text-sm">
                    Organizational email to manage this account <span className="text-[#f06548]">*</span>
                  </Label>
                  <Input
                    id="orgEmail"
                    type="email"
                    value={formData.orgEmail}
                    onChange={(e) => updateField("orgEmail", e.target.value)}
                    placeholder="organization@example.com"
                    className={fieldError("orgEmail")}
                    data-testid="input-org-email"
                  />
                  {fieldErrorMsg("orgEmail")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="investmentInfoEmail" className="text-sm">
                    Investment informational email <span className="text-[#f06548]">*</span>
                  </Label>
                  <Input
                    id="investmentInfoEmail"
                    type="email"
                    value={formData.investmentInfoEmail}
                    onChange={(e) => updateField("investmentInfoEmail", e.target.value)}
                    placeholder="investment@example.com"
                    className={fieldError("investmentInfoEmail")}
                    data-testid="input-investment-email"
                  />
                  {fieldErrorMsg("investmentInfoEmail")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mobile" className="text-sm">
                    Mobile Number <span className="text-[#f06548]">*</span>
                  </Label>
                  <Input
                    id="mobile"
                    type="tel"
                    value={formData.mobile}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      updateField("mobile", val);
                    }}
                    maxLength={10}
                    className={fieldError("mobile")}
                    data-testid="input-mobile"
                    onKeyDown={(e) => {
                      const allow = ["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight"];
                      if (allow.includes(e.key)) return;
                      if ((e.ctrlKey || e.metaKey) && ["a", "c", "v", "x"].includes(e.key.toLowerCase())) return;
                      if (!/[0-9+\-().\ ]/.test(e.key)) e.preventDefault();
                    }}
                  />
                  {fieldErrorMsg("mobile")}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Where is your company or fund legally registered (domiciled)? <span className="text-[#f06548]">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Please indicate the country where your investment vehicle is legally registered or domiciled.
                    <br />
                    Note: Contributions on CataCap are tax-deductible for U.S. donor-investors only. While we are able to work with companies and funds registered outside the U.S. in many cases, the
                    most successful campaigns typically have a strong U.S. donor-investor network.
                  </p>
                  <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={countryOpen}
                        className={cn(
                          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                          !formData.companyLocation && "text-muted-foreground",
                          fieldError("companyLocation")
                        )}
                        data-testid="select-company-location"
                      >
                        {formData.companyLocation ? countries.find((c) => c.name === formData.companyLocation)?.name || formData.companyLocation : "Select a country"}
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] bg-popover" align="start">
                      <Command className="bg-transparent">
                        <CommandInput placeholder="Search country..." />
                        <CommandList className="max-h-[280px]">
                          <CommandEmpty>No country found.</CommandEmpty>
                          <CommandGroup>
                            {countries.map((c) => (
                              <CommandItem
                                key={c.id || c.name}
                                value={c.name}
                                onSelect={(currentValue) => {
                                  updateField("companyLocation", currentValue);
                                  setCountryOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", formData.companyLocation === c.name ? "opacity-100" : "opacity-0")} />
                                {c.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {fieldErrorMsg("companyLocation")}
                </div>

                {formData.companyLocation && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="address1" className="text-sm">
                        Address Line 1 <span className="text-[#f06548]">*</span>
                      </Label>
                      <Input
                        id="address1"
                        value={formData.address1}
                        onChange={(e) => updateField("address1", e.target.value)}
                        placeholder="Address Line 1"
                        className={fieldError("address1")}
                        data-testid="input-address1"
                      />
                      {fieldErrorMsg("address1")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="address2" className="text-sm">
                        Address Line 2
                      </Label>
                      <Input id="address2" value={formData.address2} onChange={(e) => updateField("address2", e.target.value)} placeholder="Address Line 2" data-testid="input-address2" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="city" className="text-sm">
                          City <span className="text-[#f06548]">*</span>
                        </Label>
                        <Input id="city" value={formData.city} onChange={(e) => updateField("city", e.target.value)} placeholder="City" className={fieldError("city")} data-testid="input-city" />
                        {fieldErrorMsg("city")}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">
                          State <span className="text-[#f06548]">*</span>
                        </Label>
                        {formData.companyLocation === "USA" ? (
                          <>
                            <Popover open={stateOpen} onOpenChange={setStateOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={stateOpen}
                                  className={cn(
                                    "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                                    !formData.state && "text-muted-foreground",
                                    fieldError("state")
                                  )}
                                  data-testid="select-state"
                                >
                                  {formData.state || "Select state"}
                                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] bg-popover" align="start">
                                <Command className="bg-transparent">
                                  <CommandInput placeholder="Search state..." />
                                  <CommandList className="max-h-[280px]">
                                    <CommandEmpty>No state found.</CommandEmpty>
                                    <CommandGroup>
                                      {US_STATES.map((s) => (
                                        <CommandItem
                                          key={s}
                                          value={s}
                                          onSelect={(currentValue) => {
                                            updateField("state", currentValue);
                                            setStateOpen(false);
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-4 w-4", formData.state === s ? "opacity-100" : "opacity-0")} />
                                          {s}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : (
                          <Input
                            id="state"
                            value={formData.state}
                            onChange={(e) => updateField("state", e.target.value)}
                            placeholder="State / Province / Region"
                            className={fieldError("state")}
                            data-testid="input-state"
                          />
                        )}
                        {fieldErrorMsg("state")}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="zipCode" className="text-sm">
                        Zip Code <span className="text-[#f06548]">*</span>
                      </Label>
                      <Input
                        id="zipCode"
                        value={formData.zipCode}
                        onChange={(e) => updateField("zipCode", e.target.value)}
                        placeholder="Zip Code"
                        className={fieldError("zipCode")}
                        data-testid="input-zipcode"
                      />
                      {fieldErrorMsg("zipCode")}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="howMuchMoney" className="text-sm">
                    How much money do you have soft-circled for your CataCap campaign? <span className="text-[#f06548]">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">Companies and funds must have at least $25,000 in pre-commitments lined up from donor-investors prior to going live on CataCap.</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="howMuchMoney"
                      type="number"
                      value={formData.howMuchMoney}
                      onChange={(e) => updateField("howMuchMoney", e.target.value.replace(/[^0-9]/g, ""))}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="e.g., 50,000"
                      className={`pl-7 ${fieldError("howMuchMoney")}`}
                      data-testid="input-how-much"
                      onKeyDown={(e) => {
                        if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
                      }}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("Text");
                        if (!/^\d*\.?\d*$/.test(pasted)) e.preventDefault();
                      }}
                    />
                  </div>
                  {fieldErrorMsg("howMuchMoney")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="aboutNetwork" className="text-sm">
                    Tell us a bit about your network — how many potential investors or supporters you can reach (e.g., social media presence, email list size, past backers), as well as any key
                    champions in your corner. <span className="text-[#f06548]">*</span>
                  </Label>
                  <Textarea
                    id="aboutNetwork"
                    value={formData.aboutNetwork}
                    onChange={(e) => updateField("aboutNetwork", e.target.value)}
                    placeholder="e.g., 5,000 followers on LinkedIn, 2,000 email subscribers, backed by notable angel investor"
                    rows={3}
                    className={fieldError("aboutNetwork")}
                    data-testid="input-about-network"
                  />
                  {fieldErrorMsg("aboutNetwork")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Have you received funding from Impact Assets before? <span className="text-[#f06548]">*</span>
                  </Label>
                  <RadioGroup value={formData.receivedFundingBefore} onValueChange={(val) => updateField("receivedFundingBefore", val)} data-testid="radio-funding-before">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="no" id="funding-no" />
                      <Label htmlFor="funding-no" className="font-normal cursor-pointer text-sm">
                        No
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="yes" id="funding-yes" />
                      <Label htmlFor="funding-yes" className="font-normal cursor-pointer text-sm">
                        Yes
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="notsure" id="funding-not-sure" />
                      <Label htmlFor="funding-not-sure" className="font-normal cursor-pointer text-sm">
                        Not sure
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Does your company have a corporate bank account set up? <span className="text-[#f06548]">*</span>
                  </Label>
                  <RadioGroup value={formData.hasCorporateBankAccount} onValueChange={(val) => updateField("hasCorporateBankAccount", val)} data-testid="radio-corporate-bank-account">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="yes" id="corp-bank-yes" />
                      <Label htmlFor="corp-bank-yes" className="font-normal cursor-pointer text-sm">Yes</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="no" id="corp-bank-no" />
                      <Label htmlFor="corp-bank-no" className="font-normal cursor-pointer text-sm">No</Label>
                    </div>
                  </RadioGroup>
                  {fieldErrorMsg("hasCorporateBankAccount")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Does any board member, officer, or related party stand to receive personal financial benefit from this investment? <span className="text-[#f06548]">*</span>
                  </Label>
                  <RadioGroup value={formData.hasPersonalFinancialBenefit} onValueChange={(val) => updateField("hasPersonalFinancialBenefit", val)} data-testid="radio-personal-financial-benefit">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="yes" id="pfb-yes" />
                      <Label htmlFor="pfb-yes" className="font-normal cursor-pointer text-sm">Yes</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="no" id="pfb-no" />
                      <Label htmlFor="pfb-no" className="font-normal cursor-pointer text-sm">No</Label>
                    </div>
                  </RadioGroup>
                  {fieldErrorMsg("hasPersonalFinancialBenefit")}
                  {formData.hasPersonalFinancialBenefit === "yes" && (
                    <div className="space-y-1.5 pt-2">
                      <Label htmlFor="personalFinancialBenefitDescription" className="text-sm">Please describe</Label>
                      <Textarea
                        id="personalFinancialBenefitDescription"
                        value={formData.personalFinancialBenefitDescription}
                        onChange={(e) => updateField("personalFinancialBenefitDescription", e.target.value)}
                        rows={3}
                        data-testid="input-personal-financial-benefit-description"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Has the organization or any of its officers ever been subject to regulatory action, criminal investigation, or sanctions? <span className="text-[#f06548]">*</span>
                  </Label>
                  <RadioGroup value={formData.hasRegulatoryIssues} onValueChange={(val) => updateField("hasRegulatoryIssues", val)} data-testid="radio-regulatory-issues">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="yes" id="reg-yes" />
                      <Label htmlFor="reg-yes" className="font-normal cursor-pointer text-sm">Yes</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="no" id="reg-no" />
                      <Label htmlFor="reg-no" className="font-normal cursor-pointer text-sm">No</Label>
                    </div>
                  </RadioGroup>
                  {fieldErrorMsg("hasRegulatoryIssues")}
                  {formData.hasRegulatoryIssues === "yes" && (
                    <div className="space-y-1.5 pt-2">
                      <Label htmlFor="regulatoryIssuesDescription" className="text-sm">Please describe</Label>
                      <Textarea
                        id="regulatoryIssuesDescription"
                        value={formData.regulatoryIssuesDescription}
                        onChange={(e) => updateField("regulatoryIssuesDescription", e.target.value)}
                        rows={3}
                        data-testid="input-regulatory-issues-description"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Is the organization currently in good legal standing with all relevant regulatory bodies? <span className="text-[#f06548]">*</span>
                  </Label>
                  <RadioGroup value={formData.isInGoodLegalStanding} onValueChange={(val) => updateField("isInGoodLegalStanding", val)} data-testid="radio-good-legal-standing">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="yes" id="legal-yes" />
                      <Label htmlFor="legal-yes" className="font-normal cursor-pointer text-sm">Yes</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="no" id="legal-no" />
                      <Label htmlFor="legal-no" className="font-normal cursor-pointer text-sm">No</Label>
                    </div>
                  </RadioGroup>
                  {fieldErrorMsg("isInGoodLegalStanding")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="role" className="text-sm">
                    Your role with the Investment <span className="text-[#f06548]">*</span>
                  </Label>
                  <Select value={formData.role} onValueChange={(val) => updateField("role", val)}>
                    <SelectTrigger className={fieldError("role")} data-testid="select-role">
                      <SelectValue placeholder="Select your role" />
                    </SelectTrigger>
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
                  {fieldErrorMsg("role")}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">How were you referred to CataCap? </Label>
                  <Select value={formData.referralSource} onValueChange={(val) => updateField("referralSource", val)}>
                    <SelectTrigger className={fieldError("referralSource")} data-testid="select-referral">
                      <SelectValue placeholder="Select how you heard about us" />
                    </SelectTrigger>
                    <SelectContent>
                      {REFERRAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldErrorMsg("investmentType")}
                </div>
              </div>
            )}

            {currentStep === 1 && (
              <div className="space-y-5" data-testid="step-about-investment">
                <h5 className="text-base font-semibold mb-4">About the Investment</h5>

                <div className="space-y-1.5">
                  <Label htmlFor="investmentName" className="text-sm">
                    Investment Name <span className="text-[#f06548]">*</span>
                  </Label>
                  <Input
                    id="investmentName"
                    value={formData.investmentName}
                    onChange={(e) => updateField("investmentName", e.target.value)}
                    placeholder="Name of the investment"
                    className={fieldError("investmentName")}
                    data-testid="input-investment-name"
                    maxLength={100}
                  />
                  {fieldErrorMsg("investmentName")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="aboutInvestment" className="text-sm">
                    About the Investment (Not to exceed 3,000 characters) <span className="text-[#f06548]">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    This section will appear on your campaign page. Please provide a high-level overview of your company or fund, the progress you've made, and the impact you're driving. Use this
                    section to help donor-investors understand why your work matters and how their support can accelerate your next stage of growth.
                  </p>
                  <RichTextEditor
                    value={formData.aboutInvestment}
                    onChange={(val) => updateField("aboutInvestment", val)}
                    placeholder="Investment Description"
                    className={fieldError("aboutInvestment")}
                    data-testid="input-about-investment"
                    maxLength={3000}
                  />
                  {fieldErrorMsg("aboutInvestment")}
                  <p className="text-xs text-muted-foreground text-right">{stripHtml(formData.aboutInvestment).length} / 3,000 characters</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="investmentWebsite" className="text-sm">
                    Investment website URL <span className="text-[#f06548]">*</span>
                  </Label>
                  <Input
                    id="investmentWebsite"
                    value={formData.investmentWebsite}
                    onChange={(e) => updateField("investmentWebsite", e.target.value)}
                    placeholder="https://www.example.com"
                    className={fieldError("investmentWebsite")}
                    data-testid="input-investment-website"
                  />
                  {fieldErrorMsg("investmentWebsite")}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Investment Instruments (Select all that apply) <span className="text-[#f06548]">*</span>
                  </Label>
                  <Popover open={investmentTypeOpen} onOpenChange={setInvestmentTypeOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={investmentTypeOpen}
                        className={cn(
                          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                          formData.investmentType.length === 0 && "text-muted-foreground",
                          fieldError("investmentType")
                        )}
                        data-testid="select-investment-type"
                      >
                        <span className="truncate flex-1 min-w-0 text-left">
                          {formData.investmentType.length > 0
                            ? investmentTypes
                              .filter((t) => formData.investmentType.includes(t.id))
                              .map((t) => t.name)
                              .join(", ")
                            : "Select Investment Instruments"}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] bg-popover" align="start">
                      <Command className="bg-transparent">
                        <CommandInput placeholder="Search investment instruments..." />
                        <CommandList className="max-h-[280px]">
                          <CommandEmpty>No results found.</CommandEmpty>
                          <CommandGroup>
                            {investmentTypes.map((type) => (
                              <CommandItem
                                key={type.id || type.name}
                                onSelect={() => {
                                  setFormData((prev) => {
                                    const arr = prev.investmentType;
                                    const next = arr.includes(type.id) ? arr.filter((x) => x !== type.id) : [...arr, type.id];
                                    return { ...prev, investmentType: next };
                                  });
                                  if (errors.investmentType) {
                                    setErrors((prev) => ({ ...prev, investmentType: "" }));
                                  }
                                }}
                              >
                                <div className="flex items-center gap-2 w-full">
                                  <Checkbox
                                    id={`type-drop-${type.id}`}
                                    checked={formData.investmentType.includes(type.id)}
                                    onCheckedChange={() => { }} // Controlled by Item select
                                  />
                                  <span>{type.name}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {fieldErrorMsg("investmentType")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="investmentTerms" className="text-sm">
                    Investment Terms (provide 3-10 bullet points of key terms) <span className="text-[#f06548]">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Please summarize your investment terms for potential donor-investors. Consider including expected valuation cap (specify if pre- or post-money), any discounts offered, timeline /
                    return expectations, etc.
                  </p>
                  <RichTextEditor
                    value={formData.investmentTerms}
                    onChange={(val) => updateField("investmentTerms", val)}
                    placeholder="Investment Terms"
                    suggestions={staticTerms}
                    className={fieldError("investmentTerms")}
                    data-testid="input-investment-terms"
                    maxLength={2000}
                  />
                  {fieldErrorMsg("investmentTerms")}
                  <p className="text-xs text-muted-foreground text-right">{stripHtml(formData.investmentTerms).length} / 2,000 characters</p>
                </div>

                <div className="space-y-3" data-testid="note-section">
                  <p className="text-sm">
                    <span className="font-bold">NOTE:</span> All investments will also display the following text. And, if you own terms require customization, the CataCap Team will collaborate with
                    you.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    CataCap pools donor commitments and deploys them into the related company or fund once the required $50,000 minimum is reached. If the minimum is not met, your commitment will be
                    available in your CataCap account for reallocation or can be transferred as{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#405189] underline" data-testid="link-outlined">
                      outlined
                    </a>{" "}
                    (see Transfers). Funds cannot be returned to a private foundation or personal account once a tax-deductible contribution is made. The terms above are the official terms of the
                    underlying company or fund; they apply to CataCap as the investing entity and are provided for informational purposes.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fundraisingGoal" className="text-sm">
                    CataCap Fundraising Goal ($US) <span className="text-[#f06548]">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">How much do you want to raise through your CataCap campaign?</p>
                  <Input
                    id="fundraisingGoal"
                    type="number"
                    value={formData.fundraisingGoal}
                    onChange={(e) => updateField("fundraisingGoal", e.target.value.replace(/[^0-9.]/g, ""))}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="Fundraising Goal"
                    className={fieldError("fundraisingGoal")}
                    data-testid="input-fundraising-goal"
                    min={1}
                    onKeyDown={(e) => {
                      if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData("text");
                      if (!/^\d+$/.test(pasted)) e.preventDefault();
                    }}
                  />
                  {fieldErrorMsg("fundraisingGoal")}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="missionVision" className="text-sm">
                    Mission/Vision (Not to exceed 1,000 characters) <span className="text-[#f06548]">*</span>
                  </Label>
                  <Textarea
                    id="missionVision"
                    value={formData.missionVision}
                    onChange={(e) => updateField("missionVision", e.target.value)}
                    placeholder="Mission/Vision"
                    rows={4}
                    maxLength={1000}
                    className={fieldError("missionVision")}
                    data-testid="input-mission-vision"
                  />
                  {fieldErrorMsg("missionVision")}
                  <p className="text-xs text-muted-foreground text-right">{formData.missionVision.length} / 1,000 characters</p>
                  <p className="text-xs text-muted-foreground">Which type of personalized quote, to convey the mission and vision of your investment, would you like to share?</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Expected Fundraising Close Date? <span className="text-[#f06548]">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Checkbox id="evergreen" checked={formData.evergreen} onCheckedChange={(checked) => updateField("evergreen", !!checked)} data-testid="checkbox-evergreen" />
                    <Label htmlFor="evergreen" className="text-sm font-normal cursor-pointer">
                      Evergreen
                    </Label>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={formData.evergreen}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !formData.expectedCloseDate && "text-muted-foreground",
                          fieldError("expectedCloseDate"),
                          formData.evergreen ? "opacity-50 cursor-not-allowed" : ""
                        )}
                        data-testid="input-expected-close-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.expectedCloseDate ? formatDate(formData.expectedCloseDate) : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.expectedCloseDate ? new Date(formData.expectedCloseDate) : undefined}
                        onSelect={(date) => updateField("expectedCloseDate", date ? date.toISOString() : "")}
                        initialFocus
                        data-testid="calendar-expected-close-date"
                      />
                    </PopoverContent>
                  </Popover>
                  {errors["expectedCloseDate"] && <p className="text-xs text-[#f06548] mt-1">{errors["expectedCloseDate"]}</p>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="featuredInvestment"
                      checked={formData.featuredInvestment}
                      onCheckedChange={(checked) => updateField("featuredInvestment", !!checked)}
                      data-testid="checkbox-featured"
                    />
                    <Label htmlFor="featuredInvestment" className="text-sm font-normal cursor-pointer">
                      Featured Investment
                    </Label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="thankYouMessage" className="text-sm">
                    Personalized Thank You <span className="text-[#f06548]">*</span>
                  </Label>
                  <Textarea
                    id="thankYouMessage"
                    value={formData.thankYouMessage}
                    onChange={(e) => updateField("thankYouMessage", e.target.value)}
                    placeholder="Personalized Thank You"
                    rows={4}
                    className={fieldError("thankYouMessage")}
                    data-testid="input-thank-you"
                  />
                  {fieldErrorMsg("thankYouMessage")}
                  <p className="text-xs text-muted-foreground">What would you like your customized thank you message - displayed to users following a donation to your Investment - to say?</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="metaTitle" className="text-sm">Meta Title</Label>
                    <Input
                      id="metaTitle"
                      value={formData.metaTitle}
                      onChange={(e) => updateField("metaTitle", e.target.value)}
                      placeholder="Enter meta title"
                      data-testid="input-meta-title"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="metaDescription" className="text-sm">Meta Description</Label>
                    <Textarea
                      id="metaDescription"
                      value={formData.metaDescription}
                      onChange={(e) => updateField("metaDescription", e.target.value)}
                      placeholder="Enter meta description"
                      rows={2}
                      data-testid="input-meta-description"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    Investment Themes Covered (Select all that apply) <span className="text-[#f06548]">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {themes.map((theme) => (
                      <div key={theme.id || theme.name} className="flex items-center gap-2">
                        <Checkbox
                          id={`theme-${theme.id}`}
                          checked={formData.investmentThemes.includes(theme.id)}
                          onCheckedChange={() => toggleArrayItem("investmentThemes", theme.id)}
                          data-testid={`checkbox-theme-${theme.id}`}
                        />
                        <Label htmlFor={`theme-${theme.id || theme.name}`} className="text-sm font-normal cursor-pointer">
                          {theme.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {errors["investmentThemes"] && <p className="text-xs text-[#f06548] mt-1">{errors["investmentThemes"]}</p>}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    SDGs Impacted by Investment (Select all that apply) <span className="text-[#f06548]">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sdgOptions.map((sdg) => (
                      <div key={sdg.id || sdg.name} className="flex items-center gap-2">
                        <Checkbox id={`sdg-${sdg.id}`} checked={formData.sdgs.includes(sdg.id)} onCheckedChange={() => toggleArrayItem("sdgs", sdg.id)} data-testid={`checkbox-sdg-${sdg.id}`} />
                        <Label htmlFor={`sdg-${sdg.id || sdg.name}`} className="text-sm font-normal cursor-pointer">
                          {sdg.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {errors["sdgs"] && <p className="text-xs text-[#f06548] mt-1">{errors["sdgs"]}</p>}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-5" data-testid="step-media">
                <h5 className="text-base font-semibold mb-4">Media</h5>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Company / Investment Logo (max file size 10 MB) {!isEditMode && <span className="text-[#f06548]">*</span>}
                  </Label>
                  <div
                    className="border rounded-md p-6 text-center cursor-pointer transition-colors hover:border-[#405189]/50 hover:bg-[#405189]/5"
                    onClick={() => logoRef.current?.click()}
                    data-testid="upload-logo"
                  >
                    <input ref={logoRef} type="file" accept=".png,.jpg,.jpeg,.gif" className="hidden" onChange={handleLogoChange} />
                    {formData.logoFile || formData.logoFileName ? (
                      <div className="flex flex-col items-center">
                        <img
                          src={formData.logoFile ? URL.createObjectURL(formData.logoFile) : getUrlBlobContainerImage(formData.logoFileName || "")}
                          alt="Logo"
                          className="w-[100px] h-[100px] rounded object-contain mb-2"
                          onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                        />
                        <p className="text-sm font-medium text-[#0ab39c]">{formData.logoFile ? formData.logoFile.name : formData.logoFileName}</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Click to Upload File.</p>
                      </>
                    )}
                  </div>
                  {(fileErrors["logoFile"] || errors["logoFile"]) && <p className="text-xs text-[#f06548] mt-1">{fileErrors["logoFile"] || errors["logoFile"]}</p>}
                  <p className="text-xs text-muted-foreground">
                    This image used when your link is shared. For best display results, please provide a .png, .gif, or .jpg logo with at least 600
                    ppi (pixels per inch) resolution.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Company / Investment Profile Image (max file size 10 MB) {!isEditMode && <span className="text-[#f06548]">*</span>}
                  </Label>
                  <div
                    className="border rounded-md p-6 text-center cursor-pointer transition-colors hover:border-[#405189]/50 hover:bg-[#405189]/5"
                    onClick={() => profileRef.current?.click()}
                    data-testid="upload-profile-image"
                  >
                    <input ref={profileRef} type="file" accept=".png,.jpg,.jpeg,.gif" className="hidden" onChange={handleProfileImageChange} />
                    {formData.profileImageFile || formData.imageFileName ? (
                      <div className="flex flex-col items-center">
                        <img
                          src={formData.profileImageFile ? URL.createObjectURL(formData.profileImageFile) : getUrlBlobContainerImage(formData.imageFileName || "")}
                          alt="Profile"
                          className="w-[200px] h-[105px] rounded object-cover mb-2"
                          onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                        />
                        <p className="text-sm font-medium text-[#0ab39c]">{formData.profileImageFile ? formData.profileImageFile.name : formData.imageFileName}</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Click to Upload File.</p>
                      </>
                    )}
                  </div>
                  {(fileErrors["profileImageFile"] || errors["profileImageFile"]) && <p className="text-xs text-[#f06548] mt-1">{fileErrors["profileImageFile"] || errors["profileImageFile"]}</p>}
                  <p className="text-xs text-muted-foreground">
                    This image appears on your investment page (e.g.,{" "}
                    <a
                      href="https://catacap.org/investments/empowerherfund"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline break-all"
                    >
                      https://catacap.org/investments/empowerherfund
                    </a>
                    ). For best display results, please provide a .png, .gif, or .jpg logo file with at
                    least 600 ppi (pixels per inch) resolution. We also see that Investments have the best results with a 763 x 400 pixel ratio.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Company / Investment Smaller Image (max file size 10 MB) {!isEditMode && <span className="text-[#f06548]">*</span>}
                  </Label>
                  <div
                    className="border rounded-md p-6 text-center cursor-pointer transition-colors hover:border-[#405189]/50 hover:bg-[#405189]/5"
                    onClick={() => smallerRef.current?.click()}
                    data-testid="upload-smaller-image"
                  >
                    <input ref={smallerRef} type="file" accept=".png,.jpg,.jpeg,.gif" className="hidden" onChange={handleSmallerImageChange} />
                    {formData.smallerImageFile || formData.tileImageFileName ? (
                      <div className="flex flex-col items-center">
                        <img
                          src={formData.smallerImageFile ? URL.createObjectURL(formData.smallerImageFile) : getUrlBlobContainerImage(formData.tileImageFileName || "")}
                          alt="Smaller"
                          className="w-[181px] h-[125px] rounded object-cover mb-2"
                          onError={(e) => { (e.target as HTMLImageElement).src = defaultImage; }}
                        />
                        <p className="text-sm font-medium text-[#0ab39c]">{formData.smallerImageFile ? formData.smallerImageFile.name : formData.tileImageFileName}</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Click to Upload File.</p>
                      </>
                    )}
                  </div>
                  {(fileErrors["smallerImageFile"] || errors["smallerImageFile"]) && <p className="text-xs text-[#f06548] mt-1">{fileErrors["smallerImageFile"] || errors["smallerImageFile"]}</p>}
                  <p className="text-xs text-muted-foreground">
                    This image appears on find pages (e.g.,{" "}
                    <a
                      href="https://catacap.org/investments"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline break-all"
                    >
                      https://catacap.org/investments
                    </a>
                    ). For best display results, please provide a .png, .gif, or .jpg logo file with a 362 x 250 pixel ratio.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Company / Investment Pitch Deck (max file size 20 MB) {!isEditMode && <span className="text-[#f06548]">*</span>}
                  </Label>
                  <div
                    className="border rounded-md p-6 text-center cursor-pointer transition-colors hover:border-[#405189]/50 hover:bg-[#405189]/5"
                    onClick={() => pitchDeckRef.current?.click()}
                    data-testid="upload-pitch-deck"
                  >
                    <input ref={pitchDeckRef} type="file" accept=".pdf" className="hidden" onChange={handlePitchDeckChange} />
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    {formData.pitchDeckFile ? (
                      <p className="text-sm font-medium text-[#0ab39c]">{formData.pitchDeckFile.name}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Click to Upload File.</p>
                    )}
                  </div>
                  {(fileErrors["pitchDeckFile"] || errors["pitchDeckFile"]) && <p className="text-xs text-[#f06548] mt-1">{fileErrors["pitchDeckFile"] || errors["pitchDeckFile"]}</p>}
                  <p className="text-xs text-muted-foreground">
                    The pitch deck appears on the investment pages for authenticated users only (e.g.,{" "}
                    <a
                      href="https://catacap.org/investments/empowerherfund"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline break-all"
                    >
                      https://catacap.org/investments/empowerherfund
                    </a>
                    ). For best display results, please provide a .pdf
                    file with the highest resolution possible yet while maintaining the file size limitations.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 mt-8 pt-5 border-t">
              {currentStep > 0 ? (
                <Button variant="outline" onClick={handlePrev} data-testid="button-previous">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Previous
                </Button>
              ) : (
                <div />
              )}

              {currentStep < STEPS.length - 1 ? (
                <Button onClick={handleNext} className="bg-[#0ab39c] hover:bg-[#099a86] border-[#0ab39c]" data-testid="button-next">
                  Next
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !isFormComplete(formData, isEditMode)}
                  className="bg-[#405189] hover:bg-[#364574] border-[#405189]"
                  data-testid="button-submit"
                >
                  {isSubmitting ? (
                    <>Submitting...</>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1.5" />
                      Submit Application
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {cropperOpen && cropperImage && (
        <BannerCropper
          image={cropperImage}
          aspect={cropperAspect}
          onCancel={() => {
            setCropperOpen(false);
            setCropperImage(null);
            setCropperTarget(null);
          }}
          onCropped={handleCropSave}
        />
      )}
    </AdminLayout>
  );
}
