import type { Patch } from './patches.ts';

export const STOCK_IMAGE_DIRECTIVE =
  'Save generated images inside the workspace and embed them with Markdown using their absolute path.';

export const IMAGE_LINK_DIRECTIVE =
  'Save generated images inside the workspace. In chat replies, use ordinary Markdown links to screenshots and images using their absolute file paths, for example [Screenshot](/absolute/path/screenshot.png), so they can be opened in Preview. Do not embed screenshots or images with ![]() Markdown or inline image data in chat replies.';

const SANITIZER_HEAD =
  'function Wd(r){if(typeof r!=="string")return null;let e=p(r).trim();if(!e)return null;';

const FILE_PATH_TO_URL =
  'if(!e.includes("://")&&e[0]!=="#"){' +
  'let $ODpath=require("path").resolve(' +
  '(e.startsWith("~/")?require("os").homedir()+e.slice(1):e).replace(/(:\\d+){1,2}$/,""));' +
  'if(require("fs").existsSync($ODpath))return require("url").pathToFileURL($ODpath).href}';

export const fileLinkPatches: readonly Patch[] = [
  {
    name: 'markdown-file-links',
    find: SANITIZER_HEAD,
    replace: SANITIZER_HEAD + FILE_PATH_TO_URL,
  },
  {
    name: 'chat-image-file-links',
    find: STOCK_IMAGE_DIRECTIVE,
    replace: `\`+${JSON.stringify(IMAGE_LINK_DIRECTIVE)}+\``,
  },
];
