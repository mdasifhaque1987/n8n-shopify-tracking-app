import { Link } from "react-router";

type SubscriptionButtonProps = {
  subscription?: {
    hasActiveSubscription?: boolean;
    subscriptionStatus?: string | null;
    plan?: {
      displayName?: string | null;
    } | null;
  } | null;
  to: string;
  active?: boolean;
  compact?: boolean;
};

export default function SubscriptionButton({
  subscription,
  to,
  active = false,
  compact = false,
}: SubscriptionButtonProps) {
  const status = String(
    subscription?.subscriptionStatus || "unverified",
  );

  const hasSubscription = Boolean(
    subscription?.hasActiveSubscription,
  );

  const planName =
    subscription?.plan?.displayName || "";

  let label = hasSubscription
    ? "My Subscription"
    : "Choose a Plan";

  let variant = active
    ? "dh-button--active"
    : "";

  if (status === "verification_error") {
    label = "Subscription Issue";
    variant = "dh-button--danger";
  }

  const classes = [
    "dh-button",
    compact ? "dh-button--compact" : "",
    variant,
  ]
    .filter(Boolean)
    .join(" ");

  const title =
    hasSubscription && planName
      ? `${planName} subscription`
      : label;

  return (
    <Link
      to={to}
      title={title}
      aria-label={title}
      className={classes}
    >
      {label}
    </Link>
  );
}
