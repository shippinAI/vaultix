// Authored teaching content is shared by the native UI and the public MCP read tool.
export const getVaultixGuidance = () => ({
  schemaVersion: "vaultix.guidance.v1",
  source: "catalog",
  a2uiVersion: "0.9.1",
  guides: [
    {
      id: "references",
      title: "Find the Right Secret Reference",
      summary: "Choose a scope, check access, and use a name without exposing its value.",
      steps: [
        {
          id: "app",
          component: "configure-step",
          target: "reference-app",
          title: "Start with Your App",
          hint: "Each app has its own project and access rules.",
          body: "Choose the app you are working on. Only projects available to your current organization and permissions appear here.",
          teaches: "A project keeps an application's secrets and access boundaries together."
        },
        {
          id: "environment",
          component: "configure-step",
          target: "reference-environment",
          title: "Choose the Environment",
          hint: "Keep development and production access separate.",
          body: "Select the environment your app will run in. Changing the app clears the environment and previous results so you cannot mistake an old scope for the new one.",
          teaches: "The same secret name can refer to different values in different environments."
        },
        {
          id: "folder",
          component: "configure-step",
          target: "reference-path",
          title: "Narrow the Folder",
          hint: "Start at / or choose a specific folder you may access.",
          body: "Use a path beginning with /. Check the app, environment and folder before asking Vaultix for references. An unavailable folder does not reveal whether another tenant owns it.",
          teaches: "Scope limits what an action may read; it does not grant permission."
        },
        {
          id: "names",
          component: "configure-step",
          target: "reference-submit",
          title: "Read Names, Keep Values Private",
          hint: "This action returns names and versions, never values.",
          body: "Show References checks your access. Copy Name copies only the reference name. Clyffy uses the same authorized source action; your application's value delivery is a separate flow.",
          teaches: "Learning this workflow does not execute it or change your vault."
        }
      ]
    },
    {
      id: "connections",
      title: "Connect Your AI Client",
      summary: "Keep model sign-in in your own client and give Clyffy scoped tools.",
      steps: [
        {
          id: "client",
          component: "configure-step",
          target: "connection-codex-subscription",
          title: "Bring Your Own AI Setup",
          hint: "Subscription and provider credentials stay in your client.",
          body: "Choose local Codex subscription sign-in, your existing Codex configuration, or another MCP client. Vaultix never asks you to paste your model credentials.",
          teaches: "Your AI provider and Vaultix authorization are separate connections."
        },
        {
          id: "configuration",
          component: "configure-step",
          target: "connection-configuration",
          title: "Add the Instance Connection",
          hint: "Copy this connection into your client's MCP settings.",
          body: "The connection points to this Vaultix instance. Add it to your existing client settings without replacing unrelated configuration. It contains no credentials.",
          teaches: "A connection URL tells the client where tools live; it does not authorize secret access."
        },
        {
          id: "boundaries",
          component: "configure-step",
          target: "connection-access",
          title: "Check What Is Available",
          hint: "Guidance is public; reference reads require authorization.",
          body: "Read the current access status below. Clyffy can explain setup and list authorized references. Native mutation, injection and hosted Nomen sign-in still need implementation and acceptance evidence.",
          teaches: "Completing this guide does not prove client sign-in or grant permissions."
        }
      ]
    },
    {
      id: "organization",
      title: "Name Your Organization",
      summary: "Create a home for your projects and team before setting up your owner account.",
      steps: [
        {
          id: "name",
          component: "configure-step",
          target: "organization-name",
          title: "Use a Name You Recognize",
          hint: "Name your business, team, brand, or personal workspace.",
          body: "An organization groups your projects, members, and access policies. Use your business or team name, or keep the suggested name. You can rename it later in organization settings.",
          teaches: "This is a display name. It does not register a domain, create public sign-in, or grant access."
        },
        {
          id: "suggestion",
          component: "configure-step",
          target: "organization-name-suggest",
          title: "Start with a Suggested Name",
          hint: "Generate another editable example.",
          body: "Suggest Another Name fills the name field with a new example. You can replace it with your own name before continuing.",
          teaches: "A suggested organization name is not a password or a secret."
        },
        {
          id: "continue",
          component: "configure-step",
          target: "organization-continue",
          title: "Continue with Your Organization",
          hint: "Review the name before the next step.",
          body: "For a new instance, continue to create your owner account with your own email and password. If you are already signed in, this action creates your organization.",
          teaches: "Reviewing this guide does not submit the form. Only the form button performs the next action."
        }
      ]
    },
    {
      id: "owner",
      title: "Create Your Owner Account",
      summary: "Use your own credentials to administer this Vaultix instance.",
      steps: [
        {
          id: "email",
          component: "configure-step",
          target: "admin-signup-email",
          title: "Choose Your Sign-in Email",
          hint: "Use an email address you control.",
          body: "This first account is the instance administrator and owns the first organization. Enter your own name and email. Invite teammates after entering the workspace.",
          teaches: "Creating the owner does not enable public signup or configure federation."
        },
        {
          id: "password",
          component: "configure-step",
          target: "admin-signup-password",
          title: "Set Your Own Password",
          hint: "Use a unique password and save it in your password manager.",
          body: "Choose and confirm a password that meets the requirements shown below the field. Password managers and paste are supported. There is no shared default password to reuse.",
          teaches:
            "Your password belongs only in the sign-in form and your password manager. Never send it to Clyffy, chat, or a guide."
        },
        {
          id: "create",
          component: "configure-step",
          target: "admin-signup-create",
          title: "Create Your Workspace",
          hint: "Save the owner and organization, then enter Vaultix.",
          body: "Create Workspace submits your account and organization. A new self-hosted instance starts invite-only with email and password sign-in. Set up federation and other access choices later in settings.",
          teaches:
            "If opening the workspace fails after creation, retry opening it or sign in. You do not need another owner account."
        }
      ]
    }
  ]
});
