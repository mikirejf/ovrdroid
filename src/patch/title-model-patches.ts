import type { Patch } from './patches.ts';

export const TITLE_MODEL_SETTING = 'sessionTitleModel';
export const DEFAULT_TITLE_MODEL = 'gpt-6-luna';

export const titleModelPatches: readonly Patch[] = [
  {
    name: 'session-title-model-setting',
    find: 'let f=u$.filter(ba),{modelId:p,customModel:g}=dRe({fallback:()=>{',
    lookups: ['let E=C().getFirstAllowedModel((O)=>!at(O))??Oi();'],
    replace: `let $ODwant=C().settings.general?.${TITLE_MODEL_SETTING}??"${DEFAULT_TITLE_MODEL}",$ODmodel=(C().getCustomModels().some(($ODcustom)=>$ODcustom.id===$ODwant)&&C().validateModelAccess($ODwant).allowed)||ba($ODwant)?$ODwant:void 0,f=$ODmodel?[$ODmodel]:u$.filter(ba),{modelId:p,customModel:g}=$ODmodel?{modelId:$ODmodel}:dRe({fallback:()=>{`,
  },
];
