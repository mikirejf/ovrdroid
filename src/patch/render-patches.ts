import { codeCopyPatches } from './code-copy-patches.ts';
import { colorPatches } from './color-patches.ts';
import { copySelectPatches } from './copy-select-patches.ts';
import { highlightPatches } from './highlight-patches.ts';
import { inkFramePatches } from './ink-frame-patches.ts';
import { renderProfilePatches } from './render-profile-patches.ts';
import { rerenderPatches } from './rerender-patches.ts';
import { rootRenderPatches } from './root-render-patches.ts';
import { rosterRenderPatches } from './roster-render-patches.ts';
import { snapshotRenderPatches } from './snapshot-render-patches.ts';
import { stackedViewPatches } from './stacked-view-patches.ts';
import { streamRenderPatches } from './stream-render-patches.ts';
import { todoRenderPatches } from './todo-render-patches.ts';

const COMMITTED_LIST =
  't(hV,{units:D1,contentWidth:x,headerWidth:k,staticKey:g1,compact:Pe,showThinking:q,permissionToolIds:X,pendingPermissionToolIds:Z})';

export const renderPatches = [
  ...inkFramePatches,
  ...streamRenderPatches,
  ...highlightPatches,
  ...codeCopyPatches,
  ...copySelectPatches,
  ...rootRenderPatches,
  ...colorPatches,
  ...rerenderPatches,
  ...todoRenderPatches,
  ...snapshotRenderPatches,
  ...rosterRenderPatches,
  ...renderProfilePatches,
  ...stackedViewPatches,
  {
    name: 'resume-expand-once',
    find: 'expandUiMessages(){if(this.renderLimit===null)return!1;let t=this.getDisplayMessagesBeforeLimit().length,o=this.renderLimit*2;if(o>=t)this.renderLimit=null;else this.renderLimit=o;return this.store.notifyMessagesChanged(),this.renderLimit!==null}',
    replace:
      'expandUiMessages(){if(this.renderLimit===null)return!1;this.renderLimit=null;return this.store.notifyMessagesChanged(),!1}',
  },
  {
    name: 'main-transcript-markdown-cache',
    find: COMMITTED_LIST,
    lookups: ['function coe({scopeKey:'],
    replace: `t(coe,{scopeKey:"main",children:${COMMITTED_LIST}})`,
  },
];
