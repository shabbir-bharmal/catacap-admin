import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { UserEmailCombobox, UserEmailMatch } from "@/components/UserEmailCombobox";
import { useToast } from "@/hooks/use-toast";
import { linkReferral, LinkReferralResponse } from "@/api/referral/referralApi";

interface AddReferralDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddReferralDialog({ open, onOpenChange }: AddReferralDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [referrerEmail, setReferrerEmail] = useState("");
  const [referrerUser, setReferrerUser] = useState<UserEmailMatch | null>(null);
  const [referredEmail, setReferredEmail] = useState("");
  const [referredUser, setReferredUser] = useState<UserEmailMatch | null>(null);

  const reset = () => {
    setReferrerEmail("");
    setReferrerUser(null);
    setReferredEmail("");
    setReferredUser(null);
  };

  const mutation = useMutation<LinkReferralResponse, any, void>({
    mutationFn: async () => {
      if (!referrerUser || !referredUser) {
        throw new Error("Please pick both users from the dropdown.");
      }
      return linkReferral({
        referrerUserId: referrerUser.id,
        referredUserId: referredUser.id,
      });
    },
    onSuccess: (data) => {
      const { inserted, totalNew, alreadyLinked } = data;
      const parts = [
        `${inserted.signup} signup`,
        `${inserted.group_join} group join${inserted.group_join === 1 ? "" : "s"}`,
        `${inserted.investment} investment${inserted.investment === 1 ? "" : "s"}`,
        `${inserted.raise_money_signup} raise-money signup${inserted.raise_money_signup === 1 ? "" : "s"}`,
      ].join(", ");
      toast({
        title: alreadyLinked && totalNew === 0
          ? "Referral already linked"
          : "Referral linked",
        description: alreadyLinked && totalNew === 0
          ? "These users are already connected and there was no new activity to back-fill."
          : `Recorded ${totalNew} new event${totalNew === 1 ? "" : "s"}: ${parts}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["referrers"] });
      queryClient.invalidateQueries({ queryKey: ["referrals", "by-referrer"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Could not link referral",
        description:
          err?.response?.data?.message ||
          err?.message ||
          "Something went wrong. Please try again.",
      });
    },
  });

  const sameUser =
    referrerUser && referredUser && referrerUser.id === referredUser.id;
  const canSubmit =
    !!referrerUser && !!referredUser && !sameUser && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!mutation.isPending) {
          if (!o) reset();
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-referral">
        <DialogHeader>
          <DialogTitle>Add Referral</DialogTitle>
          <DialogDescription>
            Link a referrer to someone they referred. We'll also credit every
            group the referred user has already joined, every investment they've
            made, and any fundraises they've started.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Referrer (the one doing the referring)</Label>
            <UserEmailCombobox
              value={referrerEmail}
              onChange={(email, user) => {
                setReferrerEmail(email);
                setReferrerUser(user);
              }}
              placeholder="Search referrer by email..."
              testId="combobox-referrer"
              allowEmpty={false}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Referred user (the new person)</Label>
            <UserEmailCombobox
              value={referredEmail}
              onChange={(email, user) => {
                setReferredEmail(email);
                setReferredUser(user);
              }}
              placeholder="Search referred user by email..."
              testId="combobox-referred"
              allowEmpty={false}
            />
          </div>

          {sameUser && (
            <p className="text-xs text-[#f06548]" data-testid="text-same-user-error">
              The referrer and the referred user must be different.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            data-testid="button-cancel-add-referral"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            data-testid="button-submit-add-referral"
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
