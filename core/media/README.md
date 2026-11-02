# Vaultix authored media

This package currently renders illustrated scenes. The
[recorded-application execution plan](../../docs/0076-recorded-workflows-and-visible-assist.md)
specifies real app capture, footage provenance, a separate recorded composition
and visible-assist acceptance. Those additions are planned, not supplied by the
current renderer.

Render the reference workflow locally with pinned Remotion dependencies:

```sh
npm ci --prefix core/media
# Existing frontend dependencies supply the pinned local Inter font.
npm ci --prefix core/frontend
npm run check --prefix core/media
npm run render --prefix core/media
```

Outputs are private build artifacts under `.cache/vaultix-media-*/`: H.264 MP4,
poster, four review frames, captions, transcript and measured receipt. The renderer
uses the existing backend guidance document, frontend semantic colors and owned
Vaultix vector mark. It makes no authenticated application calls. Example project
names and a reference identifier are illustrations, never secret values.

The 24-second, 1600×900 clip has a 5 MiB budget and its poster a 512 KiB budget.
The Remotion toolchain runs on the build machine; it is not imported by the React
application or installed into the standalone runtime image. The first render
may download Remotion's local browser. Set `VAULTIX_MEDIA_BROWSER` to an installed
Chrome executable to render without that download. Each run has its own directory;
`.cache/vaultix-media-latest.json` points to the most recent successful result.
No hosted rendering service is needed.

The owner confirms AngryVibes/wiredFRONT is a one-person business eligible for
commercial Remotion use. This package does not change the repository license.

Landing-page integration remains a separate application change. It must provide
explicit playback, `preload="none"`, a static poster, native accessible controls,
captions and a visible transcript. No autoplay, including on reduced-motion
systems. Rendered teaching does not demonstrate the live assist driver; its
acceptance remains in [the interaction specification](../../docs/0024-interaction-and-teaching-system.md).
