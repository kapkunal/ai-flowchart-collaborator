import{p as rt}from"./chunk-JWPE2WC7.js";import{Y as D,b$ as G,j as nt,an as it,bL as st,ao as ot,bM as lt,as as ct,bO as ut,d,bg as B,ar as gt,N as dt,bK as pt,bs as ht,X as ft,O as mt,ab as vt}from"./index2.js";import{p as xt}from"./cynefin-OW5HDTMX.js";import{d as Z}from"./arc.js";import{o as St}from"./ordinal.js";import"./index.js";import"./init.js";function yt(t,n){return n<t?-1:n>t?1:n>=t?0:NaN}function wt(t){return t}function At(){var t=wt,n=yt,y=null,T=D(0),l=D(G),p=D(0);function i(e){var r,o=(e=nt(e)).length,h,w,C=0,f=new Array(o),s=new Array(o),b=+T.apply(this,arguments),z=Math.min(G,Math.max(-G,l.apply(this,arguments)-b)),k,O=Math.min(Math.abs(z)/o,p.apply(this,arguments)),u=O*(z<0?-1:1),A;for(r=0;r<o;++r)(A=s[f[r]=r]=+t(e[r],r,e))>0&&(C+=A);for(n!=null?f.sort(function(E,m){return n(s[E],s[m])}):y!=null&&f.sort(function(E,m){return y(e[E],e[m])}),r=0,w=C?(z-o*u)/C:0;r<o;++r,b=k)h=f[r],A=s[h],k=b+(A>0?A*w:0)+u,s[h]={data:e[h],index:r,value:A,startAngle:b,endAngle:k,padAngle:O};return s}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:D(+e),i):t},i.sortValues=function(e){return arguments.length?(n=e,y=null,i):n},i.sort=function(e){return arguments.length?(y=e,n=null,i):y},i.startAngle=function(e){return arguments.length?(T=typeof e=="function"?e:D(+e),i):T},i.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:D(+e),i):l},i.padAngle=function(e){return arguments.length?(p=typeof e=="function"?e:D(+e),i):p},i}var $t=vt.pie,I={sections:new Map,showData:!1},W=I.sections,V=I.showData,Ct=structuredClone($t),bt=d(()=>structuredClone(Ct),"getConfig"),Dt=d(()=>{W=new Map,V=I.showData,mt()},"clear"),Tt=d(({label:t,value:n})=>{if(n<0)throw new Error(`"${t}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);W.has(t)||(W.set(t,n),B.debug(`added new section: ${t}, with value: ${n}`))},"addSection"),kt=d(()=>W,"getSections"),Mt=d(t=>{V=t},"setShowData"),zt=d(()=>V,"getShowData"),q={getConfig:bt,clear:Dt,setDiagramTitle:ut,getDiagramTitle:ct,setAccTitle:lt,getAccTitle:ot,setAccDescription:st,getAccDescription:it,addSection:Tt,getSections:kt,setShowData:Mt,getShowData:zt},Et=d((t,n)=>{rt(t,n),n.setShowData(t.showData),t.sections.map(n.addSection)},"populateDb"),Lt={parse:d(async t=>{const n=await xt("pie",t);B.debug(n),Et(n,q)},"parse")},Ot=d(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),Rt=Ot,Nt=d(t=>{const n=[...t.values()].reduce((l,p)=>l+p,0),y=[...t.entries()].map(([l,p])=>({label:l,value:p})).filter(l=>l.value/n*100>=1);return At().value(l=>l.value).sort(null)(y)},"createPieArcs"),Wt=d((t,n,y,T)=>{var Y;B.debug(`rendering pie chart
`+t);const l=T.db,p=gt(),i=dt(l.getConfig(),p.pie),e=40,r=18,o=4,h=450,w=h,C=pt(n),f=C.append("g");f.attr("transform","translate("+w/2+","+h/2+")");const{themeVariables:s}=p;let[b]=ht(s.pieOuterStrokeWidth);b??(b=2);const z=i.legendPosition,k=i.textPosition,O=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,u=Math.min(w,h)/2-e,A=Z().innerRadius(O*u).outerRadius(u),E=Z().innerRadius(u*k).outerRadius(u*k),m=f.append("g");m.append("circle").attr("cx",0).attr("cy",0).attr("r",u+b/2).attr("class","pieOuterCircle");const R=l.getSections(),J=Nt(R),Q=[s.pie1,s.pie2,s.pie3,s.pie4,s.pie5,s.pie6,s.pie7,s.pie8,s.pie9,s.pie10,s.pie11,s.pie12];let F=0;R.forEach(a=>{F+=a});const j=J.filter(a=>(a.data.value/F*100).toFixed(0)!=="0"),H=St(Q).domain([...R.keys()]);m.selectAll("mySlices").data(j).enter().append("path").attr("d",A).attr("fill",a=>H(a.data.label)).attr("class",a=>{let c="pieCircle";return i.highlightSlice==="hover"?c+=" highlightedOnHover":i.highlightSlice===a.data.label&&(c+=" highlighted"),c}),m.selectAll("mySlices").data(j).enter().append("text").text(a=>(a.data.value/F*100).toFixed(0)+"%").attr("transform",a=>"translate("+E.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const tt=f.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),L=[...R.entries()].map(([a,c])=>({label:a,value:c})),$=f.selectAll(".legend").data(L).enter().append("g").attr("class","legend");$.append("rect").attr("width",r).attr("height",r).style("fill",a=>H(a.label)).style("stroke",a=>H(a.label)),$.append("text").attr("x",r+o).attr("y",r-o).text(a=>l.getShowData()?`${a.label} [${a.value}]`:a.label);const M=Math.max(...$.selectAll("text").nodes().map(a=>(a==null?void 0:a.getBoundingClientRect().width)??0));let N=h,P=w+e;const g=r+o,_=L.length*g;switch(z){case"center":$.attr("transform",(a,c)=>{const v=g*L.length/2,x=-M/2-(r+o),S=c*g-v;return"translate("+x+","+S+")"});break;case"top":N+=_,$.attr("transform",(a,c)=>{const v=u,x=-M/2-(r+o),S=c*g-v;return`translate(${x}, ${S})`}),m.attr("transform",()=>`translate(0, ${_+g})`);break;case"bottom":N+=_,$.attr("transform",(a,c)=>{const v=-u-g,x=-M/2-(r+o),S=c*g-v;return"translate("+x+","+S+")"});break;case"left":P+=r+o+M,$.attr("transform",(a,c)=>{const v=g*L.length/2,x=-u-(r+o),S=c*g-v;return"translate("+x+","+S+")"}),m.attr("transform",()=>`translate(${M+r+o}, 0)`);break;case"right":default:P+=r+o+M,$.attr("transform",(a,c)=>{const v=g*L.length/2,x=12*r,S=c*g-v;return"translate("+x+","+S+")"});break}const U=((Y=tt.node())==null?void 0:Y.getBoundingClientRect().width)??0,et=w/2-U/2,at=w/2+U/2,X=Math.min(0,et),K=Math.max(P,at)-X;C.attr("viewBox",`${X} 0 ${K} ${N}`),ft(C,N,K,i.useMaxWidth)},"draw"),Ft={draw:Wt},Ut={parser:Lt,db:q,renderer:Ft,styles:Rt};export{Ut as diagram};
