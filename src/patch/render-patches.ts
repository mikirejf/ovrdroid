import { highlightPatches } from './highlight-patches.ts';
import { inkFramePatches } from './ink-frame-patches.ts';
import type { Patch } from './patches.ts';
import { renderProfilePatches } from './render-profile-patches.ts';
import { rootRenderPatches } from './root-render-patches.ts';
import { streamRenderPatches } from './stream-render-patches.ts';

export const MAIN_MARKDOWN_SCOPE = 'main';

const COMMITTED_LIST =
  't(t4,{units:$e.committedUnits,contentWidth:y,headerWidth:E,staticKey:ot,compact:be,showThinking:F,permissionToolIds:K,pendingPermissionToolIds:G})';

export const renderPatches: readonly Patch[] = [
  ...inkFramePatches,
  ...streamRenderPatches,
  ...highlightPatches,
  ...rootRenderPatches,
  ...renderProfilePatches,
  {
    name: 'resume-expand-once',
    find: 'expandUiMessages(){if(this.renderLimit===null)return!1;let t=un(this.store.getMessages()).length,o=this.renderLimit*2;if(o>=t)this.renderLimit=null;else this.renderLimit=o;return this.store.notifyMessagesChanged(),this.renderLimit!==null}',
    replace:
      'expandUiMessages(){if(this.renderLimit===null)return!1;this.renderLimit=null;return this.store.notifyMessagesChanged(),!1}',
  },
  {
    name: 'main-transcript-markdown-cache',
    find: `t(E0,{id:"StaticMessageList",children:${COMMITTED_LIST}})`,
    lookups: ['function mL({scopeKey:'],
    replace: `t(E0,{id:"StaticMessageList",children:t(mL,{scopeKey:"${MAIN_MARKDOWN_SCOPE}",children:${COMMITTED_LIST}})})`,
  },
];
