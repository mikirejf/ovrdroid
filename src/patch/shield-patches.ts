import type { Patch } from './patches.ts';

export interface PrefixRule {
  id: string;
  source: string;
}

export const EXTRA_PREFIX_RULES: readonly PrefixRule[] = [
  {
    id: 'aws-access-token',
    source: String.raw`(?<![\w.$-])(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}(?![\w-])`,
  },
  {
    id: 'aws-bedrock-key',
    source: String.raw`(?<![\w.$-])ABSK[A-Za-z0-9+/]{109,269}={0,2}(?![\w/+=-])`,
  },
  { id: 'digitalocean-access-token', source: String.raw`(?<![\w.$-])doo_v1_[a-f0-9]{64}(?![\w-])` },
  { id: 'digitalocean-pat', source: String.raw`(?<![\w.$-])dop_v1_[a-f0-9]{64}(?![\w-])` },
  {
    id: 'digitalocean-refresh-token',
    source: String.raw`(?<![\w.$-])dor_v1_[a-f0-9]{64}(?![\w-])`,
  },
  { id: 'databricks-token', source: String.raw`(?<![\w.$-])dapi[a-f0-9]{32}(?:-\d)?(?![\w-])` },
  { id: 'flyio-token', source: String.raw`(?<![\w.$-])fo1_[\w-]{43}(?![\w-])` },
  {
    id: 'grafana-cloud-token',
    source: String.raw`(?<![\w.$-])glc_[A-Za-z0-9+/]{32,400}={0,3}(?![\w/+=-])`,
  },
  {
    id: 'grafana-service-token',
    source: String.raw`(?<![\w.$-])glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}(?![\w-])`,
  },
  {
    id: 'terraform-cloud-token',
    source: String.raw`(?<![\w.$-])[a-z0-9]{14}\.atlasv1\.[a-z0-9\-_=]{60,70}(?![\w=-])`,
  },
  { id: 'heroku-token-v2', source: String.raw`(?<![\w.$-])HRKU-AA[0-9a-zA-Z_-]{58}(?![\w-])` },
  { id: 'huggingface-org-token', source: String.raw`(?<![\w.$-])api_org_[a-z]{34}(?![\w-])` },
  { id: 'linear-token', source: String.raw`(?<![\w.$-])lin_api_[A-Za-z0-9]{40}(?![\w-])` },
  { id: 'postman-token', source: String.raw`(?<![\w.$-])PMAK-[a-f0-9]{24}-[a-f0-9]{34}(?![\w-])` },
  { id: 'pulumi-token', source: String.raw`(?<![\w.$-])pul-[a-f0-9]{40}(?![\w-])` },
  {
    id: 'pypi-upload-token',
    source: String.raw`(?<![\w.$-])pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}(?![\w-])`,
  },
  {
    id: 'sentry-org-token',
    source: String.raw`(?<![\w.$-])sntrys_eyJpYXQiO[a-zA-Z0-9+/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[a-zA-Z0-9+/]{10,200}={0,2}_[a-zA-Z0-9+/]{43}(?![a-zA-Z0-9+/])`,
  },
  { id: 'sentry-user-token', source: String.raw`(?<![\w.$-])sntryu_[a-f0-9]{64}(?![\w-])` },
  { id: 'shopify-access-token', source: String.raw`(?<![\w.$-])shpat_[a-fA-F0-9]{32}(?![\w-])` },
  {
    id: 'shopify-custom-access-token',
    source: String.raw`(?<![\w.$-])shpca_[a-fA-F0-9]{32}(?![\w-])`,
  },
  {
    id: 'shopify-private-app-token',
    source: String.raw`(?<![\w.$-])shppa_[a-fA-F0-9]{32}(?![\w-])`,
  },
  { id: 'shopify-shared-secret', source: String.raw`(?<![\w.$-])shpss_[a-fA-F0-9]{32}(?![\w-])` },
  {
    id: 'anthropic-admin-key',
    source: String.raw`(?<![\w.$-])sk-ant-admin01-[a-zA-Z0-9_-]{93}AA(?![\w-])`,
  },
  { id: 'vault-batch-token', source: String.raw`(?<![\w.$-])hvb\.[\w-]{138,300}(?![\w-])` },
  { id: 'vault-service-token', source: String.raw`(?<![\w.$-])hvs\.[\w-]{90,120}(?![\w-])` },
  {
    id: 'onepassword-secret-key',
    source: String.raw`(?<![\w.$-])A3-[A-Z0-9]{6}-(?:[A-Z0-9]{11}|[A-Z0-9]{6}-[A-Z0-9]{5})-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}(?![\w-])`,
  },
  {
    id: 'cloudflare-user-api-token',
    source: String.raw`(?<![\w.$-])cfut_[A-Za-z0-9]{40}[A-Fa-f0-9]{8}(?![\w-])`,
  },
  {
    id: 'cloudflare-account-api-token',
    source: String.raw`(?<![\w.$-])cfat_[A-Za-z0-9]{40}[A-Fa-f0-9]{8}(?![\w-])`,
  },
];

const CODE_PATH = String.raw`/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|lua|vue|svelte|dart|ex|exs|css|scss|md|mdx|txt|rst|html|htm)\x22?$|(?:^\x22?|\/)(?:__tests__|__fixtures__|fixtures|tests?|docs)(?:\/|\x22?$)|\.(?:test|spec|test-support)\.[^\/]*$|(?:^\x22?|\/)\.env\.(?:example|sample|template)\x22?$/i`;

const NAME_PART = String.raw`(?:[a-z]{5,12}|[a-z\d]{1,4})`;

export const DOTTED_NAME = new RegExp(
  String.raw`^(?=[^.]*\.)${NAME_PART}(?:[.-]${NAME_PART})*$`,
  'u',
);

const EXTRA_RULES = EXTRA_PREFIX_RULES.map(
  ({ id, source }) => `{id:${JSON.stringify(id)},pattern:${JSON.stringify(source)}}`,
).join(',');

export const shieldPatches: readonly Patch[] = [
  {
    name: 'shield-findings-carry-guessing',
    find: 't.push({ruleId:o,start:A,end:Z,blocking:!f||v!==void 0&&!v.recovered&&Zi(v.value)})',
    replace:
      't.push({ruleId:o,start:A,end:Z,guessing:f,blocking:!f||v!==void 0&&!v.recovered&&Zi(v.value)})',
  },
  {
    name: 'shield-code-paths-skip-guessing-rules',
    find: 'cL(P.content).find(({blocking:N})=>N)',
    lookups: ['if(od(m,f)||ad(m)){v=[];return}'],
    replace: `cL(P.content).find(({blocking:N,guessing:$ODguess})=>N&&!($ODguess&&${CODE_PATH}.test(m)))`,
  },
  {
    name: 'shield-dotted-names-read-as-words',
    find: 'function nl(t,o){return vr(t)&&!pt(t)&&(o===void 0||/passw(?:or)?d/i.test(o)||!Lr(t))}',
    replace: `function nl(t,o){return vr(t)&&!pt(t)&&(o===void 0||/passw(?:or)?d/i.test(o)||!Lr(t)&&!${DOTTED_NAME}.test(t))}`,
  },
  {
    name: 'shield-extra-exact-prefix-rules',
    find: 'alwaysScrubCapture:!0}],wt=null;function vi(){',
    replace: `alwaysScrubCapture:!0},${EXTRA_RULES}],wt=null;function vi(){`,
  },
];
