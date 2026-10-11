import{a as e}from"./chunk-Cyuzqnbw.js";import{m as t,n,r}from"./createLucideIcon-Dp1v5-Rp.js";var i=e(t(),1),a={data:``},o=e=>{if(typeof window==`object`){let t=(e?e.querySelector(`#_goober`):window._goober)||Object.assign(document.createElement(`style`),{innerHTML:` `,id:`_goober`});return t.nonce=window.__nonce__,t.parentNode||(e||document.head).appendChild(t),t.firstChild}return e||a},s=/(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}\s*)/g,c=/\/\*[^]*?\*\/|  +/g,l=/\n+/g,u=(e,t)=>{let n=``,r=``,i=``;for(let a in e){let o=e[a];a[0]==`@`?a[1]==`i`?n=a+` `+o+`;`:r+=a[1]==`f`?u(o,a):a+`{`+u(o,a[1]==`k`?``:t)+`}`:typeof o==`object`?r+=u(o,t?t.replace(/([^,])+/g,e=>a.replace(/([^,]*:\S+\([^)]*\))|([^,])+/g,t=>/&/.test(t)?t.replace(/&/g,e):e?e+` `+t:t)):a):o!=null&&(a=a[1]==`-`?a:a.replace(/[A-Z]/g,`-$&`).toLowerCase(),i+=u.p?u.p(a,o):a+`:`+o+`;`)}return n+(t&&i?t+`{`+i+`}`:i)+r},d={},f=e=>{if(typeof e==`object`){let t=``;for(let n in e)t+=n+f(e[n]);return t}return e},p=(e,t,n,r,i)=>{let a=f(e),o=d[a]||(d[a]=(e=>{let t=0,n=11;for(;t<e.length;)n=101*n+e.charCodeAt(t++)>>>0;return`go`+n})(a));if(!d[o]){let t=a===e?(e=>{let t,n,r=[{}];for(;t=s.exec(e.replace(c,``));)t[4]?r.shift():t[3]?(n=t[3].replace(l,` `).trim(),r.unshift(r[0][n]=r[0][n]||{})):r[0][t[1]]=t[2].replace(l,` `).trim();return r[0]})(e):e;d[o]=u(i?{[`@keyframes `+o]:t}:t,n?``:`.`+o)}let p=n&&d.g;return n&&(d.g=d[o]),((e,t,n,r)=>{r?t.data=t.data.replace(r,e):t.data.indexOf(e)===-1&&(t.data=n?e+t.data:t.data+e)})(d[o],t,r,p),o},m=(e,t,n)=>e.reduce((e,r,i)=>{let a=t[i];if(a&&a.call){let e=a(n),t=e&&e.props&&e.props.className||/^go/.test(e)&&e;a=t?`.`+t:e&&typeof e==`object`?e.props?``:u(e,``):!1===e?``:e}return e+r+(a??``)},``);function h(e){let t=this||{},n=e.call?e(t.p):e;return p(n.unshift?n.raw?m(n,[].slice.call(arguments,1),t.p):n.reduce((e,n)=>Object.assign(e,n&&n.call?n(t.p):n),{}):n,o(t.target),t.g,t.o,t.k)}var g,_,v;h.bind({g:1});var y=h.bind({k:1});function ee(e,t,n,r){u.p=t,g=e,_=n,v=r}function b(e,t){let n=this||{};return function(){let r=arguments;function i(a,o){let s=Object.assign({},a),c=s.className||i.className;n.p=Object.assign({theme:_&&_()},s),n.o=/go\d/.test(c),s.className=h.apply(n,r)+(c?` `+c:``),t&&(s.ref=o);let l=e;return e[0]&&(l=s.as||e,delete s.as),v&&l[0]&&v(s),g(l,s)}return t?t(i):i}}var te=e=>typeof e==`function`,x=(e,t)=>te(e)?e(t):e,S=(()=>{let e=0;return()=>(++e).toString()})(),C=(()=>{let e;return()=>{if(e===void 0&&typeof window<`u`){let t=matchMedia(`(prefers-reduced-motion: reduce)`);e=!t||t.matches}return e}})(),w=20,T=`default`,E=(e,t)=>{let{toastLimit:n}=e.settings;switch(t.type){case 0:return{...e,toasts:[t.toast,...e.toasts].slice(0,n)};case 1:return{...e,toasts:e.toasts.map(e=>e.id===t.toast.id?{...e,...t.toast}:e)};case 2:let{toast:r}=t;return E(e,{type:+!!e.toasts.find(e=>e.id===r.id),toast:r});case 3:let{toastId:i}=t;return{...e,toasts:e.toasts.map(e=>e.id===i||i===void 0?{...e,dismissed:!0,visible:!1}:e)};case 4:return t.toastId===void 0?{...e,toasts:[]}:{...e,toasts:e.toasts.filter(e=>e.id!==t.toastId)};case 5:return{...e,pausedAt:t.time};case 6:let a=t.time-(e.pausedAt||0);return{...e,pausedAt:void 0,toasts:e.toasts.map(e=>({...e,pauseDuration:e.pauseDuration+a}))}}},D=[],O={toasts:[],pausedAt:void 0,settings:{toastLimit:w}},k={},A=(e,t=T)=>{k[t]=E(k[t]||O,e),D.forEach(([e,n])=>{e===t&&n(k[t])})},j=e=>Object.keys(k).forEach(t=>A(e,t)),M=e=>Object.keys(k).find(t=>k[t].toasts.some(t=>t.id===e)),N=(e=T)=>t=>{A(t,e)},P={blank:4e3,error:4e3,success:2e3,loading:1/0,custom:4e3},F=(e={},t=T)=>{let[n,r]=(0,i.useState)(k[t]||O),a=(0,i.useRef)(k[t]);(0,i.useEffect)(()=>(a.current!==k[t]&&r(k[t]),D.push([t,r]),()=>{let e=D.findIndex(([e])=>e===t);e>-1&&D.splice(e,1)}),[t]);let o=n.toasts.map(t=>({...e,...e[t.type],...t,removeDelay:t.removeDelay||e[t.type]?.removeDelay||e?.removeDelay,duration:t.duration||e[t.type]?.duration||e?.duration||P[t.type],style:{...e.style,...e[t.type]?.style,...t.style}}));return{...n,toasts:o}},I=(e,t=`blank`,n)=>({createdAt:Date.now(),visible:!0,dismissed:!1,type:t,ariaProps:{role:`status`,"aria-live":`polite`},message:e,pauseDuration:0,...n,id:n?.id||S()}),L=e=>(t,n)=>{let r=I(t,e,n);return N(r.toasterId||M(r.id))({type:2,toast:r}),r.id},R=(e,t)=>L(`blank`)(e,t);R.error=L(`error`),R.success=L(`success`),R.loading=L(`loading`),R.custom=L(`custom`),R.dismiss=(e,t)=>{let n={type:3,toastId:e};t?N(t)(n):j(n)},R.dismissAll=e=>R.dismiss(void 0,e),R.remove=(e,t)=>{let n={type:4,toastId:e};t?N(t)(n):j(n)},R.removeAll=e=>R.remove(void 0,e),R.promise=(e,t,n)=>{let r=R.loading(t.loading,{...n,...n?.loading});return typeof e==`function`&&(e=e()),e.then(e=>{let i=t.success?x(t.success,e):void 0;return i?R.success(i,{id:r,...n,...n?.success}):R.dismiss(r),e}).catch(e=>{let i=t.error?x(t.error,e):void 0;i?R.error(i,{id:r,...n,...n?.error}):R.dismiss(r)}),e};var z=1e3,B=(e,t=`default`)=>{let{toasts:n,pausedAt:r}=F(e,t),a=(0,i.useRef)(new Map).current,o=(0,i.useCallback)((e,t=z)=>{if(a.has(e))return;let n=setTimeout(()=>{a.delete(e),s({type:4,toastId:e})},t);a.set(e,n)},[]);(0,i.useEffect)(()=>{if(r)return;let e=Date.now(),i=n.map(n=>{if(n.duration===1/0)return;let r=(n.duration||0)+n.pauseDuration-(e-n.createdAt);if(r<0){n.visible&&R.dismiss(n.id);return}return setTimeout(()=>R.dismiss(n.id,t),r)});return()=>{i.forEach(e=>e&&clearTimeout(e))}},[n,r,t]);let s=(0,i.useCallback)(N(t),[t]),c=(0,i.useCallback)(()=>{s({type:5,time:Date.now()})},[s]),l=(0,i.useCallback)((e,t)=>{s({type:1,toast:{id:e,height:t}})},[s]),u=(0,i.useCallback)(()=>{r&&s({type:6,time:Date.now()})},[r,s]),d=(0,i.useCallback)((e,t)=>{let{reverseOrder:r=!1,gutter:i=8,defaultPosition:a}=t||{},o=n.filter(t=>(t.position||a)===(e.position||a)&&t.height),s=o.findIndex(t=>t.id===e.id),c=o.filter((e,t)=>t<s&&e.visible).length;return o.filter(e=>e.visible).slice(...r?[c+1]:[0,c]).reduce((e,t)=>e+(t.height||0)+i,0)},[n]);return(0,i.useEffect)(()=>{n.forEach(e=>{if(e.dismissed)o(e.id,e.removeDelay);else{let t=a.get(e.id);t&&(clearTimeout(t),a.delete(e.id))}})},[n,o]),{toasts:n,handlers:{updateHeight:l,startPause:c,endPause:u,calculateOffset:d}}},V=y`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
 transform: scale(1) rotate(45deg);
  opacity: 1;
}`,H=y`
from {
  transform: scale(0);
  opacity: 0;
}
to {
  transform: scale(1);
  opacity: 1;
}`,U=y`
from {
  transform: scale(0) rotate(90deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(90deg);
	opacity: 1;
}`,W=b(`div`)`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||`#ff4b4b`};
  position: relative;
  transform: rotate(45deg);

  animation: ${V} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;

  &:after,
  &:before {
    content: '';
    animation: ${H} 0.15s ease-out forwards;
    animation-delay: 150ms;
    position: absolute;
    border-radius: 3px;
    opacity: 0;
    background: ${e=>e.secondary||`#fff`};
    bottom: 9px;
    left: 4px;
    height: 2px;
    width: 12px;
  }

  &:before {
    animation: ${U} 0.15s ease-out forwards;
    animation-delay: 180ms;
    transform: rotate(90deg);
  }
`,G=y`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`,K=b(`div`)`
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: ${e=>e.secondary||`#e0e0e0`};
  border-right-color: ${e=>e.primary||`#616161`};
  animation: ${G} 1s linear infinite;
`,q=y`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(45deg);
	opacity: 1;
}`,ne=y`
0% {
	height: 0;
	width: 0;
	opacity: 0;
}
40% {
  height: 0;
	width: 6px;
	opacity: 1;
}
100% {
  opacity: 1;
  height: 10px;
}`,J=b(`div`)`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||`#61d345`};
  position: relative;
  transform: rotate(45deg);

  animation: ${q} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;
  &:after {
    content: '';
    box-sizing: border-box;
    animation: ${ne} 0.2s ease-out forwards;
    opacity: 0;
    animation-delay: 200ms;
    position: absolute;
    border-right: 2px solid;
    border-bottom: 2px solid;
    border-color: ${e=>e.secondary||`#fff`};
    bottom: 6px;
    left: 6px;
    height: 10px;
    width: 6px;
  }
`,Y=b(`div`)`
  position: absolute;
`,X=b(`div`)`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
`,Z=y`
from {
  transform: scale(0.6);
  opacity: 0.4;
}
to {
  transform: scale(1);
  opacity: 1;
}`,re=b(`div`)`
  position: relative;
  transform: scale(0.6);
  opacity: 0.4;
  min-width: 20px;
  animation: ${Z} 0.3s 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
`,ie=({toast:e})=>{let{icon:t,type:n,iconTheme:r}=e;return t===void 0?n===`blank`?null:i.createElement(X,null,i.createElement(K,{...r}),n!==`loading`&&i.createElement(Y,null,n===`error`?i.createElement(W,{...r}):i.createElement(J,{...r}))):typeof t==`string`?i.createElement(re,null,t):t},ae=e=>`
0% {transform: translate3d(0,${e*-200}%,0) scale(.6); opacity:.5;}
100% {transform: translate3d(0,0,0) scale(1); opacity:1;}
`,oe=e=>`
0% {transform: translate3d(0,0,-1px) scale(1); opacity:1;}
100% {transform: translate3d(0,${e*-150}%,-1px) scale(.6); opacity:0;}
`,se=`0%{opacity:0;} 100%{opacity:1;}`,ce=`0%{opacity:1;} 100%{opacity:0;}`,le=b(`div`)`
  display: flex;
  align-items: center;
  background: #fff;
  color: #363636;
  line-height: 1.3;
  will-change: transform;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1), 0 3px 3px rgba(0, 0, 0, 0.05);
  max-width: 350px;
  pointer-events: auto;
  padding: 8px 10px;
  border-radius: 8px;
`,ue=b(`div`)`
  display: flex;
  justify-content: center;
  margin: 4px 10px;
  color: inherit;
  flex: 1 1 auto;
  white-space: pre-line;
`,de=(e,t)=>{let n=e.includes(`top`)?1:-1,[r,i]=C()?[se,ce]:[ae(n),oe(n)];return{animation:t?`${y(r)} 0.35s cubic-bezier(.21,1.02,.73,1) forwards`:`${y(i)} 0.4s forwards cubic-bezier(.06,.71,.55,1)`}},fe=i.memo(({toast:e,position:t,style:n,children:r})=>{let a=e.height?de(e.position||t||`top-center`,e.visible):{opacity:0},o=i.createElement(ie,{toast:e}),s=i.createElement(ue,{...e.ariaProps},x(e.message,e));return i.createElement(le,{className:e.className,style:{...a,...n,...e.style}},typeof r==`function`?r({icon:o,message:s}):i.createElement(i.Fragment,null,o,s))});ee(i.createElement);var pe=({id:e,className:t,style:n,onHeightUpdate:r,children:a})=>{let o=i.useCallback(t=>{if(t){let n=()=>{let n=t.getBoundingClientRect().height;r(e,n)};n(),new MutationObserver(n).observe(t,{subtree:!0,childList:!0,characterData:!0})}},[e,r]);return i.createElement(`div`,{ref:o,className:t,style:n},a)},me=(e,t)=>{let n=e.includes(`top`),r=n?{top:0}:{bottom:0},i=e.includes(`center`)?{justifyContent:`center`}:e.includes(`right`)?{justifyContent:`flex-end`}:{};return{left:0,right:0,display:`flex`,position:`absolute`,transition:C()?void 0:`all 230ms cubic-bezier(.21,1.02,.73,1)`,transform:`translateY(${t*(n?1:-1)}px)`,...r,...i}},Q=h`
  z-index: 9999;
  > * {
    pointer-events: auto;
  }
`,$=16,he=({reverseOrder:e,position:t=`top-center`,toastOptions:n,gutter:r,children:a,toasterId:o,containerStyle:s,containerClassName:c})=>{let{toasts:l,handlers:u}=B(n,o);return i.createElement(`div`,{"data-rht-toaster":o||``,style:{position:`fixed`,zIndex:9999,top:$,left:$,right:$,bottom:$,pointerEvents:`none`,...s},className:c,onMouseEnter:u.startPause,onMouseLeave:u.endPause},l.map(n=>{let o=n.position||t,s=me(o,u.calculateOffset(n,{reverseOrder:e,gutter:r,defaultPosition:t}));return i.createElement(pe,{id:n.id,key:n.id,onHeightUpdate:u.updateHeight,className:n.visible?Q:``,style:s},n.type===`custom`?x(n.message,n):a?a(n):i.createElement(fe,{toast:n,position:o}))}))},ge=R,_e=()=>{let e=localStorage.getItem(`token`),t={};return e&&e!==`null`&&e!==`undefined`&&(t.Authorization=`Bearer ${e}`),t},ve=async(e=[],t,i={})=>{if(!e||e.length===0)return{success:!1,files:[]};if(i.purpose===`product-images`&&Array.from(e).reduce((e,t)=>e+t.size,0)>4*1024*1024)throw Error(`Product photos must total 4 MB or less per upload.`);if(i.purpose===`payment-proofs`&&Array.from(e).some(e=>e.size>4*1024*1024))throw Error(`Payment proof must be 4 MB or smaller.`);if([`product-images`,`review-photos`,`payment-proofs`,`progress-media`].includes(i.purpose)){let r=i.fieldNames||[],a=new FormData;Array.from(e).forEach((e,t)=>{let n=i.purpose===`payment-proofs`?`file`:r[t]||`files`;a.append(n,e,e.name)});let o={"payment-proofs":`/uploads/payment-proofs`,"product-images":`/uploads/product-images`,"review-photos":`/uploads/review-photos`,"progress-media":`/uploads/progress-media`},s={"payment-proofs":`payment proof`,"product-images":`product photos`,"review-photos":`review photos`,"progress-media":`progress proof files`},c=o[i.purpose],l=s[i.purpose];return new Promise((e,r)=>{let o=new XMLHttpRequest,s=_e(),u=i.signal,d=()=>o.abort(),f=()=>u?.removeEventListener(`abort`,d);if(u?.aborted){r(new DOMException(`Upload aborted.`,`AbortError`));return}o.open(`POST`,`${n}${c}`),Object.entries(s).forEach(([e,t])=>o.setRequestHeader(e,t)),o.upload.onprogress=e=>{e.lengthComputable&&typeof t==`function`&&t(Math.round(e.loaded/e.total*100))},o.onload=()=>{f();try{let t=JSON.parse(o.responseText||`{}`);if(o.status>=200&&o.status<300&&t.success){e(t);return}let n=Error(t.message||`Upload failed with status ${o.status}`);n.data=t,n.response=t,r(n)}catch(e){r(e)}},o.onerror=()=>{f(),r(Error(`Network error while uploading ${l}.`))},o.onabort=()=>{f(),r(new DOMException(`Upload aborted.`,`AbortError`))},u?.addEventListener(`abort`,d,{once:!0}),o.send(a)})}let a=i.purpose||`uploads`,o=Array.from(e).reduce((e,t)=>e+t.size,0),s=Array.from(e,()=>0),c=()=>{typeof t!=`function`||o===0||t(Math.round(s.reduce((e,t)=>e+t,0)/o*100))};return{success:!0,files:await Promise.all(Array.from(e).map(async(e,t)=>{let n=await r(`/uploads/cloudinary-signature`,{method:`POST`,body:JSON.stringify({purpose:a,filename:e.name})}),o=new FormData;return o.append(`file`,e),o.append(`api_key`,n.apiKey),o.append(`timestamp`,String(n.timestamp)),o.append(`signature`,n.signature),o.append(`folder`,n.folder),o.append(`public_id`,n.publicId),n.type!==`upload`&&o.append(`type`,n.type),new Promise((r,a)=>{let l=new XMLHttpRequest,u=i.signal,d=()=>l.abort(),f=()=>u?.removeEventListener(`abort`,d);if(u?.aborted){a(new DOMException(`Upload aborted.`,`AbortError`));return}l.open(`POST`,`https://api.cloudinary.com/v1_1/${n.cloudName}/${n.resourceType}/upload`),l.upload.onprogress=n=>{n.lengthComputable&&(s[t]=Math.min(n.loaded,e.size),c())},l.onload=()=>{f();try{let n=JSON.parse(l.responseText||`{}`);if(l.status>=200&&l.status<300&&n.secure_url){s[t]=e.size,c(),r({key:i.fieldNames?.[t]||`files`,url:n.secure_url,filename:n.public_id,originalName:e.name,public_id:n.public_id,resource_type:n.resource_type,format:n.format,pathname:n.public_id});return}let o=Error(n.error?.message||`Upload failed with status ${l.status}`);o.response=n,a(o)}catch(e){a(e)}},l.onerror=()=>{f(),a(Error(`Network error while uploading files to Cloudinary.`))},l.onabort=()=>{f(),a(new DOMException(`Upload aborted.`,`AbortError`))},u?.addEventListener(`abort`,d,{once:!0}),l.send(o)})}))}};export{he as n,ge as r,ve as t};