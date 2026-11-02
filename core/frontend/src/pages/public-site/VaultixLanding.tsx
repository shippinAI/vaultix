import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  BotIcon,
  BracesIcon,
  CheckIcon,
  CircleHelpIcon,
  CommandIcon,
  FingerprintIcon,
  HandIcon,
  KeyRoundIcon,
  LayersIcon,
  LockKeyholeIcon,
  PlayIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XIcon
} from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@app/components/v3/generic/Dialog/Dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3/generic/Tooltip/Tooltip";

import "./public-site.css";

const PublicRehearsal = lazy(() => import("./PublicRehearsal"));
const capabilities = [
  {
    icon: KeyRoundIcon,
    name: "Secrets, organized",
    detail:
      "Projects, environments, versions and access. A clear place for every application credential."
  },
  {
    icon: BotIcon,
    name: "AI, with boundaries",
    detail:
      "Let your tools work with references. Keep secret values in the vault and out of the conversation."
  },
  {
    icon: FingerprintIcon,
    name: "Identity, your way",
    detail: "Built-in accounts and machine identities, with federation when your team is ready."
  },
  {
    icon: ServerIcon,
    name: "Infrastructure you own",
    detail:
      "Run the same Vaultix engine on your infrastructure. Start small and keep control as you grow."
  }
];

export const VaultixLanding = () => {
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [explanation, setExplanation] = useState(false);
  const demoHeading = useRef<HTMLHeadingElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const openVideo = () => {
    dialogOpener.current = document.activeElement as HTMLElement;
    setVideoError(false);
    setVideoOpen(true);
  };
  const restoreDialogFocus = (event: Event) => {
    event.preventDefault();
    dialogOpener.current?.focus();
  };
  useEffect(() => {
    const timer = window.setTimeout(() => setPromptVisible(true), 3500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (demoOpen) demoHeading.current?.focus({ preventScroll: true });
  }, [demoOpen]);
  const openDemo = () => {
    setDemoOpen(true);
    setPromptVisible(false);
    document.getElementById("experience")?.scrollIntoView({ behavior: "instant", block: "start" });
  };
  return (
    <div className="vaultix-public">
      <Helmet>
        <title>Vaultix — Secrets you own. AI you control.</title>
        <meta
          name="description"
          content="A friendly workspace for secrets, identity and AI. Watch Vaultix in action, try a guided workflow, and build with secrets you own."
        />
      </Helmet>
      <a href="#public-main" className="public-skip">
        Skip to content
      </a>
      <header className="public-nav">
        <Link to="/" className="public-brand">
          <img src="/images/vaultix-mark.svg" width="32" height="32" alt="" />
          Vaultix<span className="public-wordmark-note">SECRETS + AI</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#platform">Platform</a>
          <a href="#experience">Experience</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <Button asChild variant="outline">
          <Link to="/login">
            Open Vaultix <ArrowRightIcon />
          </Link>
        </Button>
      </header>
      <main id="public-main">
        <section className="public-hero public-container" aria-labelledby="hero-heading">
          <div className="public-hero-copy">
            <p className="public-eyebrow">
              <span /> YOUR NEXT BUILD STARTS HERE
            </p>
            <h1 id="hero-heading">
              Build boldly.
              <br />
              <span>Keep your secrets.</span>
            </h1>
            <p className="public-intro">
              A calmer place for your secrets, your team, and your AI. Vaultix helps you move from
              “where does this go?” to “I&apos;ve got this.”
            </p>
            <div className="public-actions">
              <Button size="lg" variant="project" onClick={openDemo}>
                Try the guided experience <ArrowRightIcon />
              </Button>
              <Button size="lg" variant="outline" onClick={openVideo}>
                <PlayIcon />
                Watch Vaultix
              </Button>
            </div>
            <div className="public-trust">
              <span>
                <CheckIcon />
                Your infrastructure
              </span>
              <span>
                <CheckIcon />
                Your identities
              </span>
              <span>
                <CheckIcon />
                Your control
              </span>
            </div>
          </div>
          <div className="public-stage">
            <div className="public-stage-offset" aria-hidden="true" />
            <div className="public-window">
              <div className="public-window-bar">
                <span className="public-window-dots" aria-hidden="true">
                  ● ● ●
                </span>
                <span>
                  <LockKeyholeIcon /> vaultix.cloud
                </span>
                <span className="public-window-label">REAL APP WALKTHROUGH</span>
              </div>
              <button
                className="public-video-preview"
                type="button"
                onClick={openVideo}
                aria-label="Watch the workflow: recorded Vaultix walkthrough"
              >
                <img
                  src="/media/vaultix-tour-poster.jpg"
                  alt=""
                  width="1600"
                  height="900"
                  fetchPriority="high"
                />
                <span className="public-play">
                  <PlayIcon fill="currentColor" />
                  Watch the workflow
                </span>
              </button>
              <div className="public-window-footer">
                <span>
                  <ShieldCheckIcon />
                  Values stay in your vault.
                </span>
                <span>Names. Scope. Confidence.</span>
              </div>
            </div>
            <div className="public-coach-card">
              <span className="public-coach-avatar">
                <BotIcon />
              </span>
              <div>
                <span className="public-micro">CLYFFY · YOUR GUIDE</span>
                <p>
                  Let&apos;s find the right reference.
                  <br />
                  <span>I&apos;ll show you, then you take over.</span>
                </p>
              </div>
              <SparklesIcon className="public-coach-spark" />
            </div>
          </div>
        </section>
        <div className="public-strip">
          <div className="public-container">
            <p>One workspace. Less guesswork.</p>
            <span>
              <KeyRoundIcon />
              Secrets
            </span>
            <span>
              <FingerprintIcon />
              Identity
            </span>
            <span>
              <BracesIcon />
              API + CLI
            </span>
            <span>
              <BotIcon />
              AI workflows
            </span>
          </div>
        </div>
        <section
          id="platform"
          className="public-container public-section"
          aria-labelledby="platform-heading"
        >
          <div className="public-section-heading">
            <div>
              <p className="public-eyebrow">POWER WITHOUT THE FRICTION</p>
              <h2 id="platform-heading">
                Serious capability.
                <br />A friendlier way in.
              </h2>
            </div>
            <p>
              Start with one project. Find help beside the control you&apos;re using. Keep the
              technical detail within reach, without putting it in your way.
            </p>
          </div>
          <div className="public-capabilities">
            {capabilities.map(({ icon: Icon, name, detail }, index) => (
              <article key={name}>
                <div className="public-capability-top">
                  <Icon />
                  <span>0{index + 1}</span>
                </div>
                <h3>{name}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          id="experience"
          className="public-demo-section public-section"
          aria-labelledby="experience-heading"
        >
          <div className="public-container">
            <div className="public-section-heading">
              <div>
                <p className="public-eyebrow">DON&apos;T JUST READ ABOUT IT</p>
                <h2 id="experience-heading" ref={demoHeading} tabIndex={-1}>
                  Watch. Take over.
                  <br />
                  <span>Make it yours.</span>
                </h2>
              </div>
              <p>
                A scripted Clyffy rehearsal uses the same reference controls as the app. Follow the
                callouts, pause whenever you like, or touch a control to take over.
              </p>
            </div>
            <div className="public-demo-shell">
              <div className="public-demo-top">
                <span>
                  <BotIcon />
                  THE VAULTIX EXPERIENCE
                </span>
                <span className="public-demo-label">Sample data · no account needed</span>
                <Tooltip disableHoverableContent={false}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="How this demonstration works"
                      onClick={(event) => {
                        dialogOpener.current = event.currentTarget;
                        setExplanation(true);
                      }}
                    >
                      <CircleHelpIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="pointer-events-auto max-w-xs">
                    Real interface, sample data. Open for details.
                  </TooltipContent>
                </Tooltip>
              </div>
              {demoOpen ? (
                <Suspense
                  fallback={
                    <p className="public-demo-loading" role="status">
                      Opening your sample workspace…
                    </p>
                  }
                >
                  <div className="public-demo-content">
                    <PublicRehearsal />
                  </div>
                </Suspense>
              ) : (
                <div className="public-demo-invitation">
                  <div className="public-demo-symbol" aria-hidden="true">
                    <LayersIcon />
                    <ArrowDownIcon className="public-demo-pointer" />
                  </div>
                  <h3>Your first “oh, that&apos;s easy.”</h3>
                  <p>
                    See a project selected, an environment scoped, and reference names loaded. Then
                    try it yourself.
                  </p>
                  <Button variant="project" size="lg" onClick={openDemo}>
                    <PlayIcon />
                    Open interactive rehearsal
                  </Button>
                </div>
              )}
            </div>
            <div className="public-demo-principles">
              <span>
                <CommandIcon />
                Named, inspectable actions
              </span>
              <span>
                <HandIcon />
                Human takeover at any point
              </span>
              <span>
                <LockKeyholeIcon />
                No secret values in the demo
              </span>
            </div>
          </div>
        </section>
        <section
          id="how-it-works"
          className="public-container public-section"
          aria-labelledby="how-heading"
        >
          <p className="public-eyebrow">FROM FIRST CLICK TO FIRST PROJECT</p>
          <h2 id="how-heading">
            A little guidance.
            <br />A lot more independence.
          </h2>
          <div className="public-steps">
            {[
              [
                "01",
                "Find your footing",
                "Contextual hints explain the field in front of you. Open a deeper guide whenever you need it."
              ],
              [
                "02",
                "See the steps",
                "Watch the interface respond to named actions. The callout explains what changed and why."
              ],
              [
                "03",
                "Take the controls",
                "Pause, explore, and repeat the workflow yourself. Your real workspace keeps its existing permissions."
              ]
            ].map(([number, title, body]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="public-bottom-cta">
            <div>
              <h3>Your secrets. Your next build.</h3>
              <p>Open your workspace, or watch the actual application first.</p>
            </div>
            <Button asChild variant="project" size="lg">
              <Link to="/login">
                Open Vaultix <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <footer className="public-footer public-container">
        <Link to="/" className="public-brand">
          <img src="/images/vaultix-mark.svg" width="25" height="25" alt="" />
          Vaultix
        </Link>
        <p>
          Shippin secrets you own.
          <br />
          <span>AngryVibes LLC · shippin.ai</span>
        </p>
        <a href="/api/docs">
          API reference <ArrowRightIcon />
        </a>
      </footer>
      {promptVisible && !demoOpen && !videoOpen && (
        <aside className="public-discovery" aria-label="Discover the guided experience">
          <BotIcon />
          <div>
            <p>Want to see how it feels?</p>
            <button type="button" onClick={openDemo}>
              Try a guided workflow <ArrowRightIcon />
            </button>
          </div>
          <button
            className="public-dismiss"
            type="button"
            aria-label="Dismiss guided experience suggestion"
            onClick={() => setPromptVisible(false)}
          >
            <XIcon />
          </button>
        </aside>
      )}
      <Dialog open={explanation} onOpenChange={setExplanation}>
        <DialogContent onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader>
            <DialogTitle>Real controls. A safe place to explore.</DialogTitle>
            <DialogDescription className="text-muted">
              This rehearsal uses the application&apos;s reference workspace with sample project and
              reference names.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-6 text-sm">
            <p>
              The scripted guide calls the same handlers as the controls. It cannot access your
              account or secret values. Touch a control, press a key inside the workspace, or choose
              Take over to stop it.
            </p>
            <p>
              In your signed-in Clyffy workspace, the same walkthrough reads through authorized
              Vaultix actions. Connecting your own AI client is a separate step.
            </p>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent
          className="w-[calc(100%-2rem)] max-w-5xl"
          onCloseAutoFocus={restoreDialogFocus}
        >
          <DialogHeader>
            <DialogTitle>Vaultix, in the actual app</DialogTitle>
            <DialogDescription className="text-muted">
              A recorded disposable workspace, edited with Remotion. No customer data or live AI
              session.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-5">
            {videoOpen && (
              <video
                controls
                playsInline
                preload="none"
                poster="/media/vaultix-tour-poster.jpg"
                className="w-full rounded-md border border-border"
                aria-label="Recorded Vaultix project workflow"
                onError={() => setVideoError(true)}
              >
                <source src="/media/vaultix-tour.mp4" type="video/mp4" />
                <track
                  kind="captions"
                  src="/media/vaultix-tour.vtt"
                  srcLang="en"
                  label="English"
                  default
                />
              </video>
            )}
            {videoError && (
              <p role="alert">
                The recording could not load. You can still try the interactive rehearsal or read
                the transcript.
              </p>
            )}
            <details>
              <summary className="cursor-pointer py-2 text-sm">Read the transcript</summary>
              <ol className="list-inside list-decimal space-y-3 py-3 text-sm text-muted">
                <li>Start in the Vaultix organization workspace. Choose Secrets Management.</li>
                <li>Open the project dialog and give the project a clear name.</li>
                <li>
                  Create the project. Vaultix opens its overview with the available environments.
                </li>
                <li>
                  Open Clyffy and the guided reference workspace. Follow the controls while values
                  stay in the vault.
                </li>
              </ol>
            </details>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
};
