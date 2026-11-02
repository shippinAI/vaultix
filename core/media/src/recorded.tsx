import React from 'react';
import {AbsoluteFill,Composition,Img,OffthreadVideo,registerRoot,staticFile,useCurrentFrame} from 'remotion';

type Props={startFrame:number;duration:number;chapters:{title:string;frame:number;caption:string}[]};
const RecordedWorkflow=({startFrame,chapters}:Props)=>{
  const frame=useCurrentFrame();
  const index=chapters.reduce((selected,chapter,i)=>frame>=chapter.frame?i:selected,0);
  const chapter=chapters[index];
  return <AbsoluteFill style={{background:'#10161e',color:'#edf3f8',fontFamily:'Inter, sans-serif'}}>
    <style>{`@font-face{font-family:Inter;src:url('${staticFile('inter.woff2')}') format('woff2');}`}</style>
    <div style={{display:'flex',alignItems:'center',gap:14,padding:'18px 30px',height:70}}><Img src={staticFile('vaultix-mark.svg')} style={{width:32,height:32}}/><span style={{fontSize:26}}>Vaultix</span><span style={{marginLeft:18,fontSize:16,color:'#5eead4'}}>YOUR SECRETS. YOUR NEXT BUILD.</span><span style={{marginLeft:'auto',fontSize:15,color:'#a0adbc'}}>Recorded application · scripted walkthrough</span></div>
    <div style={{position:'absolute',top:70,left:64,width:1472,height:828,border:'1px solid #344353',borderRadius:8,overflow:'hidden'}}><OffthreadVideo src={staticFile('workflow.webm')} trimBefore={startFrame} muted style={{width:'100%',height:'100%',objectFit:'contain'}} /></div>
    <div style={{position:'absolute',left:88,bottom:28,maxWidth:590,padding:'18px 23px',background:'#141e29',border:'1px solid #5eead4',borderRadius:7}}><div style={{fontSize:13,color:'#5eead4',letterSpacing:2,marginBottom:8}}>0{index+1} / THE WORKFLOW</div><div style={{fontSize:26,marginBottom:8}}>{chapter?.title}</div><div style={{fontSize:17,lineHeight:1.5,color:'#a0adbc'}}>{chapter?.caption}</div></div>
  </AbsoluteFill>;
};
registerRoot(()=><Composition id="VaultixRecordedWorkflow" component={RecordedWorkflow} width={1600} height={900} fps={30} durationInFrames={30} defaultProps={{startFrame:0,duration:30,chapters:[]}} calculateMetadata={({props})=>({durationInFrames:props.duration})}/>);
