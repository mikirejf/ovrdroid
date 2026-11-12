import type { Patch } from './patches.ts';

export const TITLE_MODEL_SETTING = 'sessionTitleModel';
export const DEFAULT_TITLE_MODEL = 'gpt-6-luna';

export const titleModelPatches: readonly Patch[] = [
  {
    name: 'session-title-model-setting',
    find: 'let S=AC(),M=S.customModel?[S.modelId]:Jn(S.modelId,t),',
    lookups: ['let o=uRe.filter(ps),n=io(e)?', 'C().getFirstAllowedModel((c)=>!ze(c))'],
    replace: `let S=AC(),$ODwant=C().settings.general?.${TITLE_MODEL_SETTING}??"${DEFAULT_TITLE_MODEL}",$ODmodel=(C().getCustomModels().some(($ODcustom)=>$ODcustom.id===$ODwant)&&C().validateModelAccess($ODwant).allowed)||ps($ODwant)?$ODwant:void 0,M=$ODmodel?[$ODmodel]:S.customModel?[S.modelId]:Jn(S.modelId,t),`,
  },
];
