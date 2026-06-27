import * as React from "react";
import { Bug, ExternalLink, Heart, Star } from "lucide-react";
import { Button } from "@src/components/ui/button";
import { SectionHeading, SettingGroup, SettingRow } from "../SettingsPrimitives";
import { GitHubIcon, XIcon } from "../BrandIcons";
import {
  AUTHOR_AVATAR_URL,
  AUTHOR_GITHUB_URL,
  AUTHOR_HANDLE,
  AUTHOR_NAME,
  AUTHOR_X_HANDLE,
  AUTHOR_X_URL,
  REPO_ISSUES_URL,
  REPO_URL,
} from "../links";

const ExternalAction = ({
  href,
  children,
  variant = "outline",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "outline" | "default";
}) => (
  <Button asChild variant={variant} size="sm">
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  </Button>
);

export function FeedbackSection() {
  const [avatarOk, setAvatarOk] = React.useState(true);

  return (
    <div>
      <SectionHeading
        title="Feedback"
        description="VibeSearch is free and open source. Issues, ideas, and stars are all hugely appreciated."
      />

      {/* Author card */}
      <a
        href={AUTHOR_GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center gap-3 rounded-xl border border-border-neutral-faded bg-background-page-secondary/50 px-4 py-3 transition-colors hover:bg-background-page-secondary"
      >
        {avatarOk ? (
          <img
            src={AUTHOR_AVATAR_URL}
            alt={AUTHOR_NAME}
            width={44}
            height={44}
            loading="lazy"
            onError={() => setAvatarOk(false)}
            className="size-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-faded text-sm font-semibold text-accent">
            SS
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground-neutral">{AUTHOR_NAME}</div>
          <div className="text-[13px] text-foreground-secondary">Creator of VibeSearch · @{AUTHOR_HANDLE}</div>
        </div>
        <ExternalLink className="size-4 shrink-0 text-foreground-tertiary" />
      </a>

      <SettingGroup label="Support the project">
        <SettingRow
          title="Star VibeSearch on GitHub"
          description="A star helps more people discover the project. It means a lot."
        >
          <ExternalAction href={REPO_URL}>
            <Star className="size-4" />
            Star
          </ExternalAction>
        </SettingRow>

        <SettingRow
          title="Report a bug or request a feature"
          description="Found something broken or have an idea? Open an issue and we'll take a look."
        >
          <ExternalAction href={REPO_ISSUES_URL}>
            <Bug className="size-4" />
            Open an issue
          </ExternalAction>
        </SettingRow>

        <SettingRow
          title="Browse the source"
          description="Read the code, contribute, or fork it — it's all open."
        >
          <ExternalAction href={REPO_URL}>
            <GitHubIcon className="size-4" />
            Repository
          </ExternalAction>
        </SettingRow>
      </SettingGroup>

      <SettingGroup label="Connect">
        <SettingRow
          title={
            <span className="flex items-center gap-2">
              <XIcon className="size-3.5" />
              {`@${AUTHOR_X_HANDLE} on X`}
            </span>
          }
          description="Follow along, share feedback, or just say hi."
        >
          <ExternalAction href={AUTHOR_X_URL}>Connect on X</ExternalAction>
        </SettingRow>
      </SettingGroup>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-foreground-tertiary">
        Made with <Heart className="size-3 fill-accent text-accent" /> by {AUTHOR_NAME}
      </p>
    </div>
  );
}
