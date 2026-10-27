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
    }
  ]
});
