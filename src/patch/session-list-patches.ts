import type { Patch } from './patches.ts';

export const LIST_BODY_CAP = 40;

export const LIST_CHROME_ROWS = 16;

export const SESSION_FIT_START =
  'static $ODfitStart($ODs,$ODroom){if($ODroom<=0)return"";if(globalThis.Bun.stringWidth($ODs)<=$ODroom)return $ODs;' +
  'let $ODa=[...$ODs],$ODo="",$ODu=0;for(let $ODk=$ODa.length-1;$ODk>=0;$ODk--){let $ODx=globalThis.Bun.stringWidth($ODa[$ODk]);' +
  'if($ODu+$ODx>$ODroom-1)break;$ODo=$ODa[$ODk]+$ODo;$ODu+=$ODx}return"\\u2026"+$ODo}';

export const SESSION_WRAP =
  'static $ODwrap($ODtext,$ODroom,$ODmax){let $ODsw=globalThis.Bun.stringWidth,$ODout=[],$ODcur="";' +
  'for(let $ODword of $ODtext.slice(0,$ODroom*$ODmax*2+80).split(" ")){' +
  'if($ODsw($ODword)>$ODroom){if($ODcur)$ODout.push($ODcur);$ODcur="";' +
  'while($ODsw($ODword)>$ODroom){let $ODpart=Ar($ODword,$ODroom).slice;$ODout.push($ODpart);$ODword=$ODword.slice($ODpart.length)}}' +
  'if(!$ODword)continue;let $ODnext=$ODcur?$ODcur+" "+$ODword:$ODword;' +
  'if($ODsw($ODnext)<=$ODroom)$ODcur=$ODnext;else{$ODout.push($ODcur);$ODcur=$ODword}}' +
  'if($ODcur)$ODout.push($ODcur);' +
  'return $ODout.length<=$ODmax?$ODout:[...$ODout.slice(0,$ODmax-1),Li($ODout.slice($ODmax-1).join(" "),$ODroom)]}';

export const SESSION_AGE =
  'static $ODage($ODt,$ODnow){let $ODm=Math.floor(Math.max(0,$ODnow-$ODt)/6e4),$ODh=Math.floor($ODm/60),$ODd=Math.floor($ODh/24);' +
  'return $ODm<1?"now":$ODm<60?$ODm+"m":$ODh<24?$ODh+"h":$ODd<14?$ODd+"d":$ODd<60?Math.floor($ODd/7)+"w":Math.floor($ODd/30)+"mo"}';

export const SESSION_BRANCH =
  'static $ODstatusBranch($ODt){let $ODm=/% git status --short --branch\\n## ([^\\n]*)/.exec($ODt);' +
  'if(!$ODm||$ODm[1].startsWith("HEAD (no branch)"))return null;let $ODl=$ODm[1],$ODf=/^No commits yet on (\\S+)/.exec($ODl);' +
  'if($ODf)return $ODf[1];let $ODd=$ODl.indexOf("...");return($ODd>=0?$ODl.slice(0,$ODd):$ODl.replace(/ \\[.*\\]$/,"")).trim()||null}';

export const SESSION_SHOWN =
  'static $ODshown($ODt){return $ODt' +
  '.replace(/#session-([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,"#$1")' +
  '.replace(/\\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/gi,"$1")' +
  '.replace(/^\\/delegate\\s+/,"")}';

export const SESSION_BLEND =
  'static $ODblend($ODa,$ODb,$ODt){let $ODhex=/^#[0-9a-f]{6}$/i;if(!$ODhex.test($ODa)||!$ODhex.test($ODb))return $ODa||void 0;' +
  'return"#"+[1,3,5].map(($ODk)=>{let $ODp=parseInt($ODa.slice($ODk,$ODk+2),16),$ODq=parseInt($ODb.slice($ODk,$ODk+2),16);' +
  'return Math.round($ODp+($ODq-$ODp)*$ODt).toString(16).padStart(2,"0")}).join("")}';

export const NO_MESSAGE = '(no message)';

export const GUTTER_WIDE = 16;

export const GUTTER_NARROW = 12;

export const GUTTER_MIN = 4;

export const GUTTER_DROP_BELOW = 30;

export const SESSION_BLOCK =
  `static $ODgutter($ODin){return $ODin>=100?${GUTTER_WIDE}:$ODin<${GUTTER_DROP_BELOW}?0:Math.min(${GUTTER_NARROW},Math.max(${GUTTER_MIN},Math.floor($ODin/3)))}` +
  'static $ODsessionBlock($ODit,$ODsel,$ODbg,$ODin,$ODnow,$ODroom){' +
  'let $ODsw=globalThis.Bun.stringWidth,$ODg=this.$ODgutter($ODin),$ODcw=Math.max(1,$ODg?$ODin-$ODg-4:$ODin-2),$ODx=$ODsel?"Sel":"",' +
  '$ODs=$ODit.$ODrow,$ODhead=$ODit.$ODhead,$ODpl=$ODit.$ODplace,$ODmsg=$ODhead?.text?this.$ODshown($ODhead.text):"",' +
  '$ODput=($ODgut,$ODgs,$ODtext,$ODts)=>({bg:$ODbg,segs:[[$ODsel?"\\u258C":" ","bar"],' +
  '[$ODg?" "+$ODgut+" ".repeat(Math.max(0,$ODg+2-$ODsw($ODgut))):" ",$ODgs+$ODx],[$ODtext,$ODts]]}),' +
  '$ODcap=$ODsel?Math.min(4,Math.max(0,$ODroom-2)):2,' +
  `$ODbody=!$ODcap?[]:$ODmsg?this.$ODwrap($ODmsg,$ODcw,$ODcap):["${NO_MESSAGE}"],$ODms=$ODmsg?"msg"+$ODx:"none",` +
  '$ODgut=[this.$ODfitStart($ODpl.label,$ODg),Li($ODhead?.branch??"",$ODg)],$ODago=this.$ODage($ODs.modifiedTime,$ODnow),' +
  '$ODlines=[$ODput(Li($ODago,$ODg),"time",Li($ODit.label,$ODcw),"title"+$ODx)];' +
  'while($ODbody.length<Math.min(2,$ODcap))$ODbody.push("");' +
  '$ODbody.forEach(($ODm,$ODk)=>$ODlines.push($ODput($ODgut[$ODk]??"","place",$ODm,$ODms)));' +
  'if(!$ODsel||$ODroom<2)return $ODlines;' +
  'let $ODn=$ODs.messageCount,$ODfirst=this.$ODage($ODs.createdTime,$ODnow),' +
  '$ODmeta=($ODg?"":$ODago+" \\u00B7 ")+$ODn+($ODn===1?" message":" messages")+" \\u00B7 started "+($ODfirst==="now"?"just now":$ODfirst+" ago");' +
  'if($ODs.cwd&&(!$ODpl.root||$ODsw($ODpl.label)>$ODg))' +
  '$ODmeta+=" \\u00B7 "+this.$ODfitStart(this.$ODhomePath($ODs.cwd),Math.max(8,$ODcw-$ODsw($ODmeta)-3));' +
  '$ODlines.push($ODput("","place",Li($ODmeta,$ODcw),"meta"));return $ODlines}';

export const SESSION_VIEW =
  'static $ODsessionView($ODitems,$ODpick,$ODin,$ODrows,$ODfrom,$ODnow){' +
  'let $ODn=$ODitems.length,$ODsel=Math.max(0,Math.min($ODn-1,$ODpick)),' +
  `$ODh=Math.min(${LIST_BODY_CAP},Math.max(3,$ODrows-${LIST_CHROME_ROWS}),4*$ODn+3),` +
  '$ODblock=($ODk)=>{let $ODb=this.$ODsessionBlock($ODitems[$ODk],$ODk===$ODsel,$ODk===$ODsel?"band":"",$ODin,$ODnow,$ODh);' +
  'return $ODk<$ODn-1?[...$ODb,{bg:"",segs:[]}]:$ODb},' +
  '$ODopen=$ODblock($ODsel),$ODsize=($ODk)=>$ODk===$ODsel?$ODopen.length:$ODk<$ODn-1?4:3,' +
  '$ODend=($ODt)=>{let $ODu=0,$ODk=$ODt;while($ODk<$ODn&&($ODk===$ODt||$ODu+$ODsize($ODk)<=$ODh))$ODu+=$ODsize($ODk++);return $ODk},' +
  '$ODrest=($ODt)=>{let $ODu=0;for(let $ODk=$ODt;$ODk<$ODn;$ODk++)$ODu+=$ODsize($ODk);return $ODu},' +
  '$ODtop=Math.max(0,Math.min($ODfrom,$ODn-1));' +
  'if($ODsel<$ODtop)$ODtop=$ODsel;while($ODend($ODtop)<=$ODsel)$ODtop++;' +
  'while($ODtop>0&&$ODend($ODtop)===$ODn&&$ODrest($ODtop-1)<=$ODh)$ODtop--;' +
  'let $ODlast=$ODend($ODtop),$ODlines=[];' +
  'for(let $ODk=$ODtop;$ODk<=$ODlast&&$ODk<$ODn&&$ODlines.length<$ODh;$ODk++)$ODlines.push(...($ODk===$ODsel?$ODopen:$ODblock($ODk)));' +
  '$ODlines.length=Math.min($ODlines.length,$ODh);while($ODlines.length<$ODh)$ODlines.push({bg:"",segs:[]});' +
  'return{top:$ODtop,lines:$ODlines,left:"\\u2191\\u2193 \\u00B7 \\u23CE select \\u00B7 esc",right:($ODn?$ODsel+1:0)+"/"+$ODn}}';

export const SESSION_LIST_STATICS =
  SESSION_FIT_START +
  SESSION_WRAP +
  SESSION_AGE +
  SESSION_BRANCH +
  SESSION_SHOWN +
  SESSION_BLEND +
  SESSION_BLOCK +
  SESSION_VIEW;

const FF_HEAD =
  'function ff({items:y,selectedIndex:E,helpText:A,width:D,minWidth:F=78,marginTop:U=1,fullWidth:z=!1,children:q,minVisibleCount:G,visibleCount:j,noBorder:X=!1}){let{t:oe}=L(),{width:ae}=Zn(),';

const LIST_COMPONENT =
  'function $ODSessionList({items:$ODitems,selectedIndex:$ODsel,width:$ODwide}){' +
  'let{width:$ODcols,height:$ODrows}=Zn(),$ODtop=S(0),$ODbox=Math.min($ODwide,$ODcols),' +
  '$ODview=uu.$ODsessionView($ODitems,$ODsel,$ODbox-4,$ODrows,$ODtop.current,Date.now()),' +
  '$ODbg={band:uu.$ODblend(o.text.userBg,o.text.primary,0.1)},$ODfaint=o.diff.unchanged.dimText,' +
  '$ODlook={bar:{color:o.primary},time:{color:o.text.muted},timeSel:{color:o.text.secondary},' +
  'place:{color:$ODfaint},placeSel:{color:o.text.muted},title:{color:o.text.primary},titleSel:{color:o.text.primary,bold:!0},' +
  'msg:{color:o.text.muted},msgSel:{color:o.text.secondary},none:{color:$ODfaint},meta:{color:o.text.muted}};' +
  '$ODtop.current=$ODview.top;' +
  'return l(T,{flexDirection:"column",width:$ODbox,marginTop:1,children:[' +
  't(T,{borderStyle:"round",borderColor:o.border,flexDirection:"column",children:$ODview.lines.map(($ODline,$ODk)=>' +
  't(T,{paddingX:1,backgroundColor:$ODbg[$ODline.bg],children:t(i,{wrap:"truncate",children:$ODline.segs.length?' +
  '$ODline.segs.map(([$ODtext,$ODstyle],$ODj)=>t(i,{...$ODlook[$ODstyle],children:$ODtext},$ODj)):" "})},$ODk))}),' +
  'l(T,{paddingX:2,justifyContent:"space-between",children:[t(i,{color:o.text.muted,wrap:"truncate",children:$ODview.left}),' +
  't(T,{flexShrink:0,marginLeft:1,children:t(i,{color:o.text.muted,children:$ODview.right})})]})]})}';

const SUGGESTION_DROPDOWN =
  't(ff,{items:mo.map((wn)=>({label:wn.label,value:wn.value,fileDisplay:wn.fileDisplay})),selectedIndex:cn,helpText:oo("chatInput.navigationHint"),width:U})';

export const sessionListPatches: readonly Patch[] = [
  {
    name: 'session-list-view',
    find: FF_HEAD,
    lookups: [
      'var Wre=()=>R().t("common:fileSuggestions.file"),r5=100;class uu{',
      'children:[t(T,{borderStyle:X?void 0:"round",borderColor:X?void 0:o.border,',
      'return l(i,{bold:Pe,children:[t(i,{color:Ne(),children:Pe?we.selectedPrefix??"> ":"  "})',
      'ao=S(null),Po=S(0),go=S(null)',
    ],
    replace: LIST_COMPONENT + FF_HEAD,
  },
  {
    name: 'session-list-render',
    find: `Nt&&mo.length>0&&${SUGGESTION_DROPDOWN}`,
    replace: `Nt&&mo.length>0&&(mo[0].$ODsession?t($ODSessionList,{items:mo,selectedIndex:cn,width:U}):${SUGGESTION_DROPDOWN})`,
  },
];
