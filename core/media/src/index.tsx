import React from 'react';
import { AbsoluteFill, Composition, Img, interpolate, registerRoot, staticFile, useCurrentFrame } from 'remotion';
import { getVaultixGuidance } from '../../backend/src/services/vaultix/guidance';
import { mediaSpec, referenceStory } from '../story.mjs';

const story: Pick<ReturnType<typeof getVaultixGuidance>['guides'][number]['steps'][number], 'id' | 'title' | 'hint'>[] = referenceStory(getVaultixGuidance());
type Palette = Record<'background' | 'foreground' | 'card' | 'project' | 'muted' | 'border', string>;
const Showcase = ({ palette }: { palette: Palette }) => {
  const frame = useCurrentFrame();
  const index = Math.min(Math.floor(frame / mediaSpec.stepFrames), story.length - 1);
  const localFrame = frame % mediaSpec.stepFrames;
  const entrance = interpolate(localFrame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const step = story[index];
  const fields = [ ['App', 'Orbit workspace'], ['Environment', index >= 1 ? 'Development' : 'Choose an environment'], ['Folder', index >= 2 ? '/api' : '/'] ];
  return <AbsoluteFill style={{ background: palette.background, color: palette.foreground, fontFamily: 'Vaultix Inter, sans-serif', padding: 66 }}>
    <style>{`@font-face {font-family: 'Vaultix Inter';src: url('${staticFile('inter.woff2')}') format('woff2');font-weight: 400;} @font-face {font-family: 'Vaultix Inter';src: url('${staticFile('inter-semibold.woff2')}') format('woff2');font-weight: 600;}`}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Img src={staticFile('vaultix-mark.svg')} style={{ width: 52, height: 52 }} />
      <span style={{ fontSize: 35, fontWeight: 600 }}>Vaultix</span>
      <span style={{ color: palette.muted, fontSize: 17, marginLeft: 18, letterSpacing: 3 }}>SECRETS YOU OWN</span>
      <span style={{ marginLeft: 'auto', color: palette.muted, fontSize: 17, border: `1px solid ${palette.border}`, padding: '12px 18px', borderRadius: 6 }}>Workflow illustration</span>
    </div>
    <div style={{ display: 'flex', gap: 64, flex: 1, alignItems: 'center' }}>
      <div style={{ width: 500, opacity: entrance, transform: `translateY(${(1 - entrance) * 12}px)` }}>
        <div style={{ color: palette.project, fontSize: 18, letterSpacing: 3, marginBottom: 25 }}>LEARN THE WORKFLOW · 0{index + 1}</div>
        <h1 style={{ fontSize: 60, lineHeight: 1.07, letterSpacing: -2, margin: '0 0 28px', fontWeight: 600 }}>{step.title}</h1>
        <p style={{ fontSize: 25, lineHeight: 1.5, color: palette.muted, margin: 0 }}>{step.hint}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 40 }}>
          {story.map((entry, i) => <div key={entry.id} style={{ height: 4, width: 65, background: i <= index ? palette.project : palette.border }} />)}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', padding: 26 }}>
        <div style={{ position: 'absolute', inset: '42px 6px 6px 42px', border: `1px solid ${palette.border}`, borderRadius: 12 }} />
        <div style={{ position: 'relative', background: palette.card, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 32, boxShadow: '0 18px 35px #00000030' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
            <span style={{ fontSize: 23, fontWeight: 600 }}>Secret references</span>
            <span style={{ fontSize: 15, color: palette.project }}>EXAMPLE WORKSPACE</span>
          </div>
          {fields.map(([label, value], i) => <div key={label} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 16, color: palette.muted, marginBottom: 9 }}>{label}</div>
            <div style={{ border: `1px solid ${index === i ? palette.project : palette.border}`, borderRadius: 6, padding: '16px 18px', fontSize: 20, display: 'flex', justifyContent: 'space-between', background: palette.background }}>
              <span>{value}</span><span style={{ color: palette.muted }}>{i < 2 ? '⌄' : '/'}</span>
            </div>
          </div>)}
          <div style={{ marginTop: 27, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ padding: '15px 20px', border: `1px solid ${palette.project}`, borderRadius: 6, fontSize: 18, background: `${palette.project}12` }}>Show References</div>
            <span style={{ fontSize: 16, color: palette.muted }}>Your permissions apply</span>
          </div>
          <div style={{ marginTop: 25, borderTop: `1px solid ${palette.border}`, paddingTop: 20, height: 48, fontSize: 18, color: index === 3 ? palette.foreground : palette.muted }}>
            {index === 3 ? 'PAYMENTS_API_KEY     ·     Reference name only' : 'Values stay in your vault.'}
          </div>
        </div>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${palette.border}`, paddingTop: 22, color: palette.muted, fontSize: 18 }}>
      <span>Understand the scope. Follow the steps. Make it yours.</span><span>vaultix.cloud</span>
    </div>
  </AbsoluteFill>;
};

registerRoot(() => <Composition id={mediaSpec.id} component={Showcase} durationInFrames={mediaSpec.stepFrames * mediaSpec.steps} fps={mediaSpec.fps} width={mediaSpec.width} height={mediaSpec.height} defaultProps={{ palette: { background: '', foreground: '', card: '', project: '', muted: '', border: '' } }} />);
