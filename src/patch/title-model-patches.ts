import type { Patch } from './patches.ts';

export const TITLE_MODEL_SETTING = 'sessionTitleModel';
export const DEFAULT_TITLE_MODEL = 'gpt-6-luna';

export const titleModelPatches: readonly Patch[] = [
  {
    name: 'session-title-model-setting',
    find: 'let{modelId:u}=Tee({fallback:()=>{let v=qU.find(qi);',
    lookups: ['let M=f().getFirstAllowedModel()??Er();'],
    replace: `let $ODwant=f().settings.general?.${TITLE_MODEL_SETTING}??"${DEFAULT_TITLE_MODEL}",$ODmodel=(f().getCustomModels().some(($ODcustom)=>$ODcustom.id===$ODwant)&&f().validateModelAccess($ODwant).allowed)||qi($ODwant)?$ODwant:void 0,{modelId:u}=$ODmodel?{modelId:$ODmodel}:Tee({fallback:()=>{let v=qU.find(qi);`,
  },
];
