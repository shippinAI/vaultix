import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function sources(){const files=[];const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())walk(p);else files.push({path:relative(root,p).replaceAll('\\','/'),sha256:hash(p)});}};walk(resolve(root,'core/frontend/src'));walk(resolve(root,'core/frontend/public/media'));files.push({path:'scripts/test-public-experience.mjs',sha256:hash(fileURLToPath(import.meta.url))});return files;}
if(process.argv.includes('--verify')){
  const pointer=JSON.parse(readFileSync(resolve(root,'.cache/public-experience-latest.json')));
  const report=JSON.parse(readFileSync(pointer.receipt));assert.equal(report.passed,true);assert.deepEqual(report.sources,sources());
  assert.ok(report.checks.length>=12);console.log(JSON.stringify({passed:true,scope:report.scope,evidence:pointer.evidence,checks:report.checks}));
}else{
  const origin=process.argv[2]??'http://127.0.0.1:3000';assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  const require=createRequire(resolve(root,'core/e2e/package.json'));
  const {chromium,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
  mkdirSync(resolve(root,'.cache'),{recursive:true});const evidence=mkdtempSync(resolve(root,'.cache/public-experience-'));
  const report={passed:false,scope:'Browser against local frontend and real guidance catalog; explicitly sampled public reference data',sources:sources(),checks:[],accessibility:[]};
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(15000);const page=await context.newPage();const errors=[];const requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
    const audit=async state=>{await page.waitForTimeout(300);const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();report.accessibility.push({state,violations:r.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),manualReview:r.incomplete.map(x=>x.id)});assert.equal(r.violations.length,0,`Accessibility: ${state}`);};
    await page.goto(origin);await expect(page.getByRole('heading',{level:1})).toContainText('Build boldly.');
    assert.equal(new URL(page.url()).pathname,'/');assert.ok(!requests.some(p=>p==='/api/v1/admin/config'||p==='/api/v1/auth/token'));
    assert.ok(!requests.some(p=>p.endsWith('.mp4')));report.checks.push('Public root without authentication/config requests or eager video');
    await audit('landing');await page.screenshot({path:resolve(evidence,'landing-desktop.png'),fullPage:true});
    await expect(page.getByRole('complementary',{name:'Discover the guided experience'})).toBeVisible({timeout:6000});
    await page.getByRole('button',{name:'Dismiss guided experience suggestion'}).click();report.checks.push('Passive suggestion can be dismissed');
    const explanation=page.getByRole('button',{name:'How this demonstration works'});
    await explanation.focus();await expect(page.getByRole('tooltip')).toBeVisible();await page.keyboard.press('Escape');
    await explanation.press('Enter');const dialog=page.getByRole('dialog',{name:'Real controls. A safe place to explore.'});await expect(dialog).toBeVisible();
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await audit('explanation');await page.keyboard.press('Escape');await expect(explanation).toBeFocused();report.checks.push('Keyboard tooltip, dialog focus trap and focus return');
    await page.getByRole('button',{name:'Try the guided experience',exact:true}).click();
    const workspace=page.getByRole('region',{name:'Interactive Vaultix rehearsal'});
    await expect(workspace.getByRole('button',{name:'Show me',exact:true})).toBeEnabled();
    await workspace.getByRole('button',{name:'Show me',exact:true}).click();
    await expect(page.locator('#reference-app')).toContainText('Orbit / storefront');
    await workspace.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForTimeout(3000);
    await expect(page.locator('#reference-environment')).toContainText('Choose an environment');report.checks.push('Pause prevents the next command');
    await workspace.getByRole('button',{name:'Resume',exact:true}).click();
    await expect(workspace.getByText('Rehearsal complete. Try the same controls yourself.',{exact:true})).toBeVisible({timeout:20000});
    await expect(workspace.getByText('PAYMENTS_API_KEY',{exact:true})).toBeVisible();await expect(workspace.getByText('DATABASE_URL',{exact:true})).toBeVisible();report.checks.push('Resume completes actual shared reference controls');
    await audit('rehearsal-complete');await page.screenshot({path:resolve(evidence,'rehearsal.png'),fullPage:true});
    await workspace.getByRole('button',{name:'Replay walkthrough'}).click();await expect(page.locator('#reference-app')).toContainText('Orbit / storefront');
    await page.locator('#reference-path').fill('/missing');await expect(workspace.getByText('You took over. Your selections are kept.',{exact:true})).toBeVisible();
    await page.waitForTimeout(3000);await expect(page.locator('#reference-path')).toHaveValue('/missing');
    await page.locator('#reference-environment').click();await page.getByRole('option',{name:'Development',exact:true}).click();
    await workspace.getByRole('button',{name:'Show References',exact:true}).click();await expect(workspace.getByRole('alert')).toBeVisible();report.checks.push('Human takeover cancels commands; missing folder produces error');
    await page.locator('#reference-path').fill('/');await workspace.getByRole('button',{name:'Show References',exact:true}).click();await expect(workspace.getByText('DATABASE_URL',{exact:true})).toBeVisible();report.checks.push('Manual controls recover from a failed read');
    await page.emulateMedia({reducedMotion:'reduce'});await workspace.getByRole('button',{name:'Replay walkthrough'}).click();await expect(page.locator('#reference-app')).toContainText('Orbit / storefront');
    await expect(workspace.getByText('Clyffy · scripted',{exact:true})).toHaveCount(0);await workspace.getByRole('button',{name:'Pause',exact:true}).click();report.checks.push('Reduced motion suppresses moving guide cursor');
    await page.setViewportSize({width:320,height:800});assert.ok(await page.locator('.vaultix-public').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await audit('mobile-rehearsal');await page.screenshot({path:resolve(evidence,'landing-mobile.png'),fullPage:true});report.checks.push('320px reflow and automated accessibility in four states');
    await page.emulateMedia({forcedColors:'active'});await expect(workspace.getByRole('button',{name:'Resume',exact:true})).toBeVisible();await page.emulateMedia({forcedColors:'none'});report.checks.push('Controls remain available in forced colors');
    await page.setViewportSize({width:1440,height:1000});
    const watch=page.getByRole('button',{name:'Watch Vaultix',exact:true});await watch.click();await expect(page.getByRole('dialog',{name:'Vaultix, in the actual app'})).toBeVisible();
    const video=page.locator('video');await video.evaluate(v=>Promise.race([v.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Video playback timeout')),15000))]));await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
    assert.ok(await video.evaluate(v=>v.duration>10&&v.duration<90));await video.evaluate(v=>{v.pause();v.currentTime=v.duration-1;});
    await expect.poll(()=>video.evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);await audit('video');
    await page.keyboard.press('Escape');await expect(watch).toBeFocused();assert.equal(await page.locator('video').count(),0);report.checks.push('Recorded video decodes, seeks and unmounts on close');
    await page.getByRole('link',{name:'Open Vaultix',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();report.checks.push('Public page navigates into existing login');
    assert.deepEqual(errors,[]);assert.deepEqual(report.sources,sources());report.passed=true;
  }finally{await browser.close();writeFileSync(resolve(evidence,'result.json'),JSON.stringify(report,null,2));if(report.passed)writeFileSync(resolve(root,'.cache/public-experience-latest.json'),JSON.stringify({evidence,receipt:resolve(evidence,'result.json')}));console.log(JSON.stringify({passed:report.passed,evidence,checks:report.checks}));}
}
