import type { Patch } from './patches.ts';

export const SNAPSHOT_STORE_READ =
  '{snapshotVersion:O,streamingVersion:F}=k0e(D.getStore(),A),K=E.current;';

export const SNAPSHOT_REBUILD =
  'K.streamingVersion===F)return K.messages;' +
  'let G=[...f.getDisplayMessages(y)];' +
  'return E.current={ssm:f,sessionId:y,updateMode:A,snapshotVersion:O,streamingVersion:F,messages:G},G}';

export const snapshotRenderPatches: readonly Patch[] = [
  {
    name: 'snapshot-stable-messages',
    find: SNAPSHOT_REBUILD,
    lookups: [SNAPSHOT_STORE_READ],
    replace:
      'K.streamingVersion===F)return K.messages;' +
      'let G=[...f.getDisplayMessages(y)],$ODv=D.getStore().getMessagesVersion();' +
      'if(K.ssm===f&&K.sessionId===y&&K.updateMode===A&&K.streamingVersion===F&&K.messagesVersion===$ODv&&' +
      'K.messages.length===G.length&&G.every(($ODm,$ODi)=>$ODm===K.messages[$ODi]))return K.snapshotVersion=O,K.messages;' +
      'return E.current={ssm:f,sessionId:y,updateMode:A,messagesVersion:$ODv,snapshotVersion:O,streamingVersion:F,messages:G},G}',
  },
];
